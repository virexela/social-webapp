import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getRoomMembersCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

interface JoinPayload {
  socialId: string;
  roomId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as JoinPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();

    if (!socialId || !roomId) {
      return NextResponse.json({ success: false, error: "socialId and roomId are required" }, { status: 400 });
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
