import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getMessagesCollection } from "@/lib/db/database";

interface MessagePayload {
  senderSocialId: string;
  roomId: string;
  messageId: string;
  encryptedContent: string;
  timestamp: number;
}

const MAX_ENCRYPTED_CONTENT_BYTES = 2_000_000;
const MAX_ID_LENGTH = 128;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MessagePayload;
    const senderSocialId = body.senderSocialId?.trim();
    const roomId = body.roomId?.trim();
    const messageId = body.messageId?.trim();
    const encryptedContent = typeof body.encryptedContent === "string" ? body.encryptedContent.trim() : "";
    const timestamp = Number(body.timestamp);

    if (!senderSocialId || !roomId || !messageId || !encryptedContent || !Number.isFinite(timestamp)) {
      return NextResponse.json({ success: false, error: "Invalid message payload" }, { status: 400 });
    }
    if (
      senderSocialId.length > MAX_ID_LENGTH ||
      roomId.length > MAX_ID_LENGTH ||
      messageId.length > MAX_ID_LENGTH ||
      encryptedContent.length > MAX_ENCRYPTED_CONTENT_BYTES
    ) {
      return NextResponse.json({ success: false, error: "Message payload exceeds limits" }, { status: 413 });
    }
    if (!/^[a-fA-F0-9]{24}$/.test(senderSocialId)) {
      return NextResponse.json({ success: false, error: "Invalid senderSocialId format" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const messages = getMessagesCollection();

    const now = new Date();
    await messages.updateOne(
      { roomId, messageId },
      {
        $set: {
          senderSocialId,
          roomId,
          messageId,
          encryptedContent,
          timestamp,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const roomId = req.nextUrl.searchParams.get("roomId")?.trim();

    if (!roomId) {
      return NextResponse.json({ success: false, error: "roomId is required" }, { status: 400 });
    }
    if (roomId.length > MAX_ID_LENGTH) {
      return NextResponse.json({ success: false, error: "Invalid roomId" }, { status: 400 });
    }

    await ensureDatabaseConnection();
    const messages = getMessagesCollection();

    const docs = await messages
      .find(
        { roomId },
        {
          projection: {
            _id: 0,
            messageId: 1,
            encryptedContent: 1,
            timestamp: 1,
            senderSocialId: 1,
          },
        }
      )
      .sort({ timestamp: 1 })
      .toArray();

    const data = docs.map((d) => ({
      id: String(d.messageId),
      encryptedContent: String(d.encryptedContent),
      timestamp: Number(d.timestamp),
      senderSocialId: String(d.senderSocialId),
    }));

    return NextResponse.json({ success: true, messages: data }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
