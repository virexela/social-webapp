import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getMessagesCollection } from "@/lib/db/database";

interface DeleteMessagePayload {
  roomId: string;
  messageId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteMessagePayload;
    const roomId = body.roomId?.trim();
    const messageId = body.messageId?.trim();

    if (!roomId || !messageId) {
      return NextResponse.json({ success: false, error: "roomId and messageId are required" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const messages = getMessagesCollection();
    await messages.deleteMany({ roomId, messageId });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
