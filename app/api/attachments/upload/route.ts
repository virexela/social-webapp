import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getAttachmentsCollection, getRoomMembersCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { hasBlockedExtension, isAllowedMimeType, isValidBase64UrlPayload } from "@/lib/server/attachmentValidation";
import { blindStableId } from "@/lib/server/privacy";
import { isValidMessageId, isValidMimeType, isValidRoomId, isValidSocialId, isValidFileName } from "@/lib/validation/schemas";

interface UploadAttachmentPayload {
  socialId: string;
  roomId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  encryptedBlobBase64Url: string;
  plaintextByteLength: number;
}

const MAX_PLAINTEXT_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_ENCRYPTED_BASE64URL_CHARS = 36 * 1024 * 1024;
const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as UploadAttachmentPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();
    const messageId = body.messageId?.trim();
    const fileName = body.fileName?.trim();
    const mimeType = body.mimeType?.trim().toLowerCase();
    const encryptedBlobBase64Url = body.encryptedBlobBase64Url?.trim();
    const plaintextByteLength = Number(body.plaintextByteLength);

    if (!socialId || !roomId || !messageId || !fileName || !mimeType || !encryptedBlobBase64Url || !Number.isFinite(plaintextByteLength)) {
      return NextResponse.json({ success: false, error: "Invalid attachment payload" }, { status: 400 });
    }

    if (!isValidSocialId(socialId) || !isValidRoomId(roomId) || !isValidMessageId(messageId)) {
      return NextResponse.json({ success: false, error: "Invalid attachment identifiers" }, { status: 400 });
    }

    if (
      !isValidFileName(fileName) ||
      !isValidMimeType(mimeType) ||
      !isAllowedMimeType(mimeType) ||
      hasBlockedExtension(fileName)
    ) {
      return NextResponse.json({ success: false, error: "Unsupported file metadata" }, { status: 400 });
    }

    if (
      plaintextByteLength <= 0 ||
      plaintextByteLength > MAX_PLAINTEXT_BYTES ||
      encryptedBlobBase64Url.length > MAX_ENCRYPTED_BASE64URL_CHARS ||
      !isValidBase64UrlPayload(encryptedBlobBase64Url)
    ) {
      return NextResponse.json({ success: false, error: "Attachment exceeds upload limits" }, { status: 413 });
    }

    const authError = await validateUserAuthenticationOrRespond(req, socialId);
    if (authError) return authError;

    await ensureDatabaseConnection();
    const attachments = getAttachmentsCollection();
    const roomMembers = getRoomMembersCollection();
    const ownerId = blindStableId(socialId);

    const membership = await roomMembers.findOne({ roomId, memberId: ownerId }, { projection: { _id: 1 } });
    if (!membership) {
      return NextResponse.json({ success: false, error: "Forbidden: not a room member" }, { status: 403 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ATTACHMENT_TTL_MS);
    const attachmentId = randomUUID();

    await attachments.insertOne({
      attachmentId,
      roomId,
      ownerId,
      messageId,
      fileName,
      mimeType,
      plaintextByteLength,
      encryptedBlobBase64Url,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

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
