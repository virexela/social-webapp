import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getPushSubscriptionsCollection, getRoomMembersCollection } from "@/lib/db/database";
import { sendWebPush } from "@/lib/server/vapid";

interface NotifyPayload {
  roomId: string;
  senderSocialId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as NotifyPayload;
    const roomId = body.roomId?.trim();
    const senderSocialId = body.senderSocialId?.trim();

    if (!roomId || !senderSocialId) {
      return NextResponse.json({ success: false, error: "roomId and senderSocialId are required" }, { status: 400 });
    }
    if (!/^[a-fA-F0-9]{24}$/.test(senderSocialId) || roomId.length > 128) {
      return NextResponse.json({ success: false, error: "Invalid notify payload" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const membersCol = getRoomMembersCollection();
    const subsCol = getPushSubscriptionsCollection();

    const members = await membersCol.find({ roomId, socialId: { $ne: senderSocialId } }, { projection: { socialId: 1, _id: 0 } }).toArray();
    if (members.length === 0) {
      return NextResponse.json({ success: true, sent: 0 }, { status: 200 });
    }

    const memberIds = members.map((m) => String(m.socialId));
    const subs = await subsCol.find({ socialId: { $in: memberIds } }).toArray();

    let sent = 0;
    for (const sub of subs) {
      const endpoint = String(sub.endpoint ?? "");
      if (!endpoint) continue;

      const result = await sendWebPush(endpoint);
      if (result.ok) {
        sent += 1;
      } else if (result.status === 404 || result.status === 410) {
        await subsCol.deleteOne({ socialId: sub.socialId, endpoint });
      }
    }

    return NextResponse.json({ success: true, sent }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
