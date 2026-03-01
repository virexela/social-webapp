import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getMessagesCollection, getRoomMembersCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";

interface DeleteMessagePayload {
  socialId: string;
  roomId: string;
  messageId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteMessagePayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();
    const messageId = body.messageId?.trim();

    if (!socialId || !roomId || !messageId) {
      return NextResponse.json({ success: false, error: "socialId, roomId and messageId are required" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const roomMembers = getRoomMembersCollection();
    const messages = getMessagesCollection();

    const membership = await roomMembers.findOne({ socialId, roomId }, { projection: { _id: 1 } });
    if (!membership) {
      return NextResponse.json({ success: false, error: "Forbidden: not a room member" }, { status: 403 });
    }

    await messages.deleteMany({ roomId, messageId });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
