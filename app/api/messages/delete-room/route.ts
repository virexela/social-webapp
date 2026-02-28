import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getMessagesCollection } from "@/lib/db/database";

interface DeleteRoomPayload {
  roomId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteRoomPayload;
    const roomId = body.roomId?.trim();
    if (!roomId) {
      return NextResponse.json({ success: false, error: "roomId is required" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const messages = getMessagesCollection();
    await messages.deleteMany({ roomId });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
