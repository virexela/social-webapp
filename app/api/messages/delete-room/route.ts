import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getMessagesCollection, getRoomMembersCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";

interface DeleteRoomPayload {
  socialId: string;
  roomId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteRoomPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();
    if (!socialId || !roomId) {
      return NextResponse.json({ success: false, error: "socialId and roomId are required" }, { status: 400 });
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

    await messages.deleteMany({ roomId });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
