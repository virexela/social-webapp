import { NextRequest, NextResponse } from "next/server";
import {
  ensureDatabaseConnection,
  getPresenceCollection,
  getRoomMembersCollection,
} from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { blindStableId } from "@/lib/server/privacy";
import { getSessionSocialIdFromRequest } from "@/lib/server/sessionAuth";
import { isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

const PRESENCE_TTL_MS = 90_000;

function parseRoomIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((roomId) => roomId.trim())
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  try {
    const sessionSocialId = await getSessionSocialIdFromRequest(req);
    const socialId = sessionSocialId ?? req.nextUrl.searchParams.get("socialId")?.trim() ?? "";

    if (!socialId || !isValidSocialId(socialId)) {
      return NextResponse.json({ success: false, error: "Invalid socialId" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const presence = getPresenceCollection();
    const memberId = blindStableId(socialId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PRESENCE_TTL_MS);

    await presence.updateOne(
      { memberId },
      { $set: { memberId, updatedAt: now, expiresAt }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );

    return NextResponse.json({ success: true, expiresAt: expiresAt.toISOString() }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sessionSocialId = await getSessionSocialIdFromRequest(req);
    const socialId = req.nextUrl.searchParams.get("socialId")?.trim() || sessionSocialId;
    const roomIds = parseRoomIds(req.nextUrl.searchParams.get("roomIds"));

    if (!socialId || !isValidSocialId(socialId)) {
      return NextResponse.json({ success: false, error: "Invalid socialId" }, { status: 400 });
    }

    if (roomIds.some((roomId) => !isValidRoomId(roomId))) {
      return NextResponse.json({ success: false, error: "Invalid roomIds" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    if (roomIds.length === 0) {
      return NextResponse.json({ success: true, onlineByRoom: {} }, { status: 200 });
    }

    await ensureDatabaseConnection();
    const ownerId = blindStableId(socialId);
    const roomMembers = getRoomMembersCollection();
    const presence = getPresenceCollection();

    const membershipDocs = await roomMembers
      .find(
        { roomId: { $in: roomIds } },
        { projection: { _id: 0, roomId: 1, memberId: 1 } }
      )
      .toArray();

    const peerIdsByRoom = new Map<string, Set<string>>();
    membershipDocs.forEach((doc) => {
      const roomId = String(doc.roomId ?? "");
      const memberId = String(doc.memberId ?? "");
      if (!roomId || !memberId || memberId === ownerId) return;
      const peers = peerIdsByRoom.get(roomId) ?? new Set<string>();
      peers.add(memberId);
      peerIdsByRoom.set(roomId, peers);
    });

    const peerIds = Array.from(new Set(Array.from(peerIdsByRoom.values()).flatMap((ids) => Array.from(ids))));
    const activePeerIds = new Set<string>();

    if (peerIds.length > 0) {
      const activeDocs = await presence
        .find(
          { memberId: { $in: peerIds }, expiresAt: { $gt: new Date() } },
          { projection: { _id: 0, memberId: 1 } }
        )
        .toArray();
      activeDocs.forEach((doc) => {
        const memberId = String(doc.memberId ?? "");
        if (memberId) activePeerIds.add(memberId);
      });
    }

    const onlineByRoom = roomIds.reduce<Record<string, boolean>>((acc, roomId) => {
      const peerIdsForRoom = peerIdsByRoom.get(roomId);
      acc[roomId] = Boolean(peerIdsForRoom && Array.from(peerIdsForRoom).some((memberId) => activePeerIds.has(memberId)));
      return acc;
    }, {});

    return NextResponse.json({ success: true, onlineByRoom }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}