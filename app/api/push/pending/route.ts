import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getPushNotificationsCollection } from "@/lib/db/database";
import { blindStableId } from "@/lib/server/privacy";
import { getSessionSocialIdFromRequest } from "@/lib/server/sessionAuth";

const MAX_PENDING_ITEMS = 50;

export async function GET(req: NextRequest) {
  try {
    const socialId = await getSessionSocialIdFromRequest(req);
    if (!socialId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    await ensureDatabaseConnection();
    const notifications = getPushNotificationsCollection();
    const ownerId = blindStableId(socialId);

    const docs = await notifications
      .find(
        { ownerId, unreadCount: { $gt: 0 } },
        {
          projection: {
            _id: 0,
            roomId: 1,
            unreadCount: 1,
            lastMessageId: 1,
            latestSenderMemberId: 1,
            latestSenderAlias: 1,
            updatedAt: 1,
          },
        }
      )
      .sort({ updatedAt: -1 })
      .limit(MAX_PENDING_ITEMS)
      .toArray();

    const pending = docs.map((doc) => ({
      roomId: String(doc.roomId ?? ""),
      unreadCount: Number(doc.unreadCount ?? 0),
      lastMessageId: String(doc.lastMessageId ?? ""),
      latestSenderMemberId: String(doc.latestSenderMemberId ?? ""),
      latestSenderAlias: String(doc.latestSenderAlias ?? ""),
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : new Date(String(doc.updatedAt)).toISOString(),
    }));

    return NextResponse.json({ success: true, pending }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
