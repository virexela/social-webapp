import { NextRequest, NextResponse } from "next/server";
import {
  ensureDatabaseConnection,
  getAttachmentUploadChunksCollection,
  getAttachmentUploadSessionsCollection,
} from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { isValidBase64UrlPayload } from "@/lib/server/attachmentValidation";
import { blindStableId } from "@/lib/server/privacy";
import { isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

interface UploadChunkPayload {
  socialId: string;
  roomId: string;
  uploadId: string;
  chunkIndex: number;
  chunkDataBase64Url: string;
}

const MAX_CHUNK_CHARS = 1_100_000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as UploadChunkPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();
    const uploadId = body.uploadId?.trim();
    const chunkDataBase64Url = body.chunkDataBase64Url?.trim();
    const chunkIndex = Number(body.chunkIndex);

    if (!socialId || !roomId || !uploadId || !chunkDataBase64Url || !Number.isFinite(chunkIndex)) {
      return NextResponse.json({ success: false, error: "Invalid upload chunk payload" }, { status: 400 });
    }

    if (!isValidSocialId(socialId) || !isValidRoomId(roomId) || chunkIndex < 0) {
      return NextResponse.json({ success: false, error: "Invalid upload chunk identifiers" }, { status: 400 });
    }

    if (chunkDataBase64Url.length > MAX_CHUNK_CHARS || !isValidBase64UrlPayload(chunkDataBase64Url)) {
      return NextResponse.json({ success: false, error: "Chunk exceeds limits" }, { status: 413 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const ownerId = blindStableId(socialId);
    const sessions = getAttachmentUploadSessionsCollection();
    const chunks = getAttachmentUploadChunksCollection();

    const session = await sessions.findOne(
      { uploadId, ownerId, roomId, expiresAt: { $gt: new Date() } },
      { projection: { totalChunks: 1, expiresAt: 1, _id: 0 } }
    );
    if (!session) {
      return NextResponse.json({ success: false, error: "Upload session not found or expired" }, { status: 404 });
    }

    const totalChunks = Number(session.totalChunks ?? 0);
    if (chunkIndex >= totalChunks) {
      return NextResponse.json({ success: false, error: "Chunk index out of range" }, { status: 400 });
    }

    await chunks.updateOne(
      { uploadId, chunkIndex },
      {
        $set: {
          uploadId,
          ownerId,
          roomId,
          chunkIndex,
          chunkDataBase64Url,
          updatedAt: new Date(),
          expiresAt: new Date(String(session.expiresAt)),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    await sessions.updateOne({ uploadId }, { $set: { updatedAt: new Date() } });

    return NextResponse.json({ success: true, chunkIndex }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
