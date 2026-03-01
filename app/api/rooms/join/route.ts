import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getRoomMembersCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { getSessionSocialIdFromRequest } from "@/lib/server/sessionAuth";
import { isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

interface JoinPayload {
  socialId: string;
  roomId: string;
}

export async function POST(req: NextRequest) {
  try {
    let body: Partial<JoinPayload> = {};
    try {
      body = (await req.json()) as JoinPayload;
    } catch {
      body = {};
    }

    const sessionSocialId = await getSessionSocialIdFromRequest(req);
    const socialId = body.socialId?.trim() || sessionSocialId || req.nextUrl.searchParams.get("socialId")?.trim();
    const roomId = body.roomId?.trim() || req.nextUrl.searchParams.get("roomId")?.trim();

    if (!socialId || !roomId) {
      return NextResponse.json({ success: false, error: "socialId and roomId are required" }, { status: 400 });
    }

    if (sessionSocialId && socialId !== sessionSocialId) {
      return NextResponse.json({ success: false, error: "Forbidden: Cannot join room as a different user" }, { status: 403 });
    }

    if (!isValidSocialId(socialId) || !isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, error: "Invalid room join payload" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const roomMembers = getRoomMembersCollection();
    await roomMembers.updateOne(
      { socialId, roomId },
      { $set: { socialId, roomId, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
