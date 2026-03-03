import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureDatabaseConnection,
  getAttachmentUploadChunksCollection,
  getAttachmentUploadSessionsCollection,
  getAttachmentsCollection,
} from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { blindStableId } from "@/lib/server/privacy";
import { isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

interface FinalizeUploadPayload {
  socialId: string;
  roomId: string;
  uploadId: string;
}

const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FinalizeUploadPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();
    const uploadId = body.uploadId?.trim();

    if (!socialId || !roomId || !uploadId) {
      return NextResponse.json({ success: false, error: "socialId, roomId and uploadId are required" }, { status: 400 });
    }

    if (!isValidSocialId(socialId) || !isValidRoomId(roomId)) {
      return NextResponse.json({ success: false, error: "Invalid finalize identifiers" }, { status: 400 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const ownerId = blindStableId(socialId);
    const sessions = getAttachmentUploadSessionsCollection();
    const chunks = getAttachmentUploadChunksCollection();
    const attachments = getAttachmentsCollection();

    const session = await sessions.findOne(
      { uploadId, ownerId, roomId, expiresAt: { $gt: new Date() } },
      {
        projection: {
          _id: 0,
          messageId: 1,
          fileName: 1,
          mimeType: 1,
          plaintextByteLength: 1,
          totalChunks: 1,
          encryptedBlobLength: 1,
        },
      }
    );
    if (!session) {
      return NextResponse.json({ success: false, error: "Upload session not found or expired" }, { status: 404 });
    }

    const chunkDocs = await chunks
      .find({ uploadId }, { projection: { _id: 0, chunkIndex: 1, chunkDataBase64Url: 1 } })
      .sort({ chunkIndex: 1 })
      .toArray();

    const totalChunks = Number(session.totalChunks ?? 0);
    if (chunkDocs.length !== totalChunks) {
      return NextResponse.json({ success: false, error: "Upload incomplete" }, { status: 409 });
    }

    for (let i = 0; i < chunkDocs.length; i += 1) {
      if (Number(chunkDocs[i].chunkIndex ?? -1) !== i) {
        return NextResponse.json({ success: false, error: "Upload chunks out of order" }, { status: 409 });
      }
    }

    const encryptedBlobBase64Url = chunkDocs.map((doc) => String(doc.chunkDataBase64Url ?? "")).join("");
    const expectedLength = Number(session.encryptedBlobLength ?? 0);
    if (expectedLength > 0 && encryptedBlobBase64Url.length !== expectedLength) {
      return NextResponse.json({ success: false, error: "Upload payload mismatch" }, { status: 409 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ATTACHMENT_TTL_MS);
    const attachmentId = randomUUID();

    await attachments.insertOne({
      attachmentId,
      roomId,
      ownerId,
      messageId: String(session.messageId ?? ""),
      fileName: String(session.fileName ?? "attachment.bin"),
      mimeType: String(session.mimeType ?? "application/octet-stream"),
      plaintextByteLength: Number(session.plaintextByteLength ?? 0),
      encryptedBlobBase64Url,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    await Promise.all([chunks.deleteMany({ uploadId }), sessions.deleteOne({ uploadId })]);

    return NextResponse.json(
      {
        success: true,
        attachmentId,
        expiresAt: expiresAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
