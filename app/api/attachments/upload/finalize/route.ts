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

function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object") {
    const candidate = value as { buffer?: Uint8Array; value?: (asRaw?: boolean) => Uint8Array };
    if (candidate.buffer instanceof Uint8Array) {
      return Buffer.from(candidate.buffer);
    }
    if (typeof candidate.value === "function") {
      return Buffer.from(candidate.value(true));
    }
  }
  return Buffer.alloc(0);
}

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
          encryptedByteLength: 1,
          encryptedBlobLength: 1,
          uploadEncoding: 1,
        },
      }
    );
    if (!session) {
      return NextResponse.json({ success: false, error: "Upload session not found or expired" }, { status: 404 });
    }

    const chunkDocs = await chunks
      .find({ uploadId }, { projection: { _id: 0, chunkIndex: 1, chunkDataBase64Url: 1, chunkData: 1 } })
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

    let encryptedBlob: Buffer;
    if (session.uploadEncoding === "binary") {
      const parts = chunkDocs.map((doc) => toBuffer(doc.chunkData));
      encryptedBlob = Buffer.concat(parts);
      const expectedLength = Number(session.encryptedByteLength ?? 0);
      if (expectedLength > 0 && encryptedBlob.length !== expectedLength) {
        return NextResponse.json({ success: false, error: "Upload payload mismatch" }, { status: 409 });
      }
    } else {
      const encryptedBlobBase64Url = chunkDocs.map((doc) => String(doc.chunkDataBase64Url ?? "")).join("");
      const expectedLength = Number(session.encryptedBlobLength ?? 0);
      if (expectedLength > 0 && encryptedBlobBase64Url.length !== expectedLength) {
        return NextResponse.json({ success: false, error: "Upload payload mismatch" }, { status: 409 });
      }
      encryptedBlob = base64UrlToBuffer(encryptedBlobBase64Url);
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
      encryptedByteLength: encryptedBlob.length,
      encryptedBlob,
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
