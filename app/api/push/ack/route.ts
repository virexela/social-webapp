import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getPushNotificationsCollection } from "@/lib/db/database";
import { blindStableId } from "@/lib/server/privacy";
import { getSessionSocialIdFromRequest } from "@/lib/server/sessionAuth";

interface AckPayload {
  roomId: string;
}

export async function POST(req: NextRequest) {
  try {
    const socialId = await getSessionSocialIdFromRequest(req);
    if (!socialId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as AckPayload;
    const roomId = body.roomId?.trim();
    if (!roomId || roomId.length > 128) {
      return NextResponse.json({ success: false, error: "roomId is required" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const notifications = getPushNotificationsCollection();
    const ownerId = blindStableId(socialId);

    await notifications.deleteOne({ ownerId, roomId });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
