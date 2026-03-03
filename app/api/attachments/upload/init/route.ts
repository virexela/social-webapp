import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureDatabaseConnection,
  getAttachmentUploadSessionsCollection,
  getRoomMembersCollection,
} from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { hasBlockedExtension, isAllowedMimeType } from "@/lib/server/attachmentValidation";
import { blindStableId } from "@/lib/server/privacy";
import {
  isValidMessageId,
  isValidMimeType,
  isValidRoomId,
  isValidSocialId,
  isValidFileName,
} from "@/lib/validation/schemas";

interface InitUploadPayload {
  socialId: string;
  roomId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  plaintextByteLength: number;
  encryptedBlobLength: number;
  totalChunks: number;
}

const MAX_PLAINTEXT_BYTES = 25 * 1024 * 1024;
const MAX_ENCRYPTED_BLOB_CHARS = 36 * 1024 * 1024;
const MAX_CHUNKS = 512;
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InitUploadPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();
    const messageId = body.messageId?.trim();
    const fileName = body.fileName?.trim();
    const mimeType = body.mimeType?.trim().toLowerCase();
    const plaintextByteLength = Number(body.plaintextByteLength);
    const encryptedBlobLength = Number(body.encryptedBlobLength);
    const totalChunks = Number(body.totalChunks);

    if (!socialId || !roomId || !messageId || !fileName || !mimeType) {
      return NextResponse.json({ success: false, error: "Invalid upload init payload" }, { status: 400 });
    }

    if (!isValidSocialId(socialId) || !isValidRoomId(roomId) || !isValidMessageId(messageId)) {
      return NextResponse.json({ success: false, error: "Invalid upload identifiers" }, { status: 400 });
    }

    if (!isValidFileName(fileName) || !isValidMimeType(mimeType) || !isAllowedMimeType(mimeType) || hasBlockedExtension(fileName)) {
      return NextResponse.json({ success: false, error: "Unsupported or unsafe file type" }, { status: 400 });
    }

    if (
      !Number.isFinite(plaintextByteLength) ||
      plaintextByteLength <= 0 ||
      plaintextByteLength > MAX_PLAINTEXT_BYTES ||
      !Number.isFinite(encryptedBlobLength) ||
      encryptedBlobLength <= 0 ||
      encryptedBlobLength > MAX_ENCRYPTED_BLOB_CHARS ||
      !Number.isFinite(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > MAX_CHUNKS
    ) {
      return NextResponse.json({ success: false, error: "Upload exceeds limits" }, { status: 413 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const roomMembers = getRoomMembersCollection();
    const sessions = getAttachmentUploadSessionsCollection();
    const ownerId = blindStableId(socialId);

    const membership = await roomMembers.findOne({ roomId, memberId: ownerId }, { projection: { _id: 1 } });
    if (!membership) {
      return NextResponse.json({ success: false, error: "Forbidden: not a room member" }, { status: 403 });
    }

    const existing = await sessions.findOne(
      { ownerId, roomId, messageId, expiresAt: { $gt: new Date() } },
      { projection: { uploadId: 1, totalChunks: 1, _id: 0 } }
    );

    if (existing?.uploadId) {
      return NextResponse.json(
        {
          success: true,
          uploadId: String(existing.uploadId),
          totalChunks: Number(existing.totalChunks ?? totalChunks),
          resumed: true,
        },
        { status: 200 }
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + UPLOAD_SESSION_TTL_MS);
    const uploadId = randomUUID();

    await sessions.insertOne({
      uploadId,
      ownerId,
      roomId,
      messageId,
      fileName,
      mimeType,
      plaintextByteLength,
      encryptedBlobLength,
      totalChunks,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    return NextResponse.json(
      {
        success: true,
        uploadId,
        totalChunks,
        resumed: false,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
