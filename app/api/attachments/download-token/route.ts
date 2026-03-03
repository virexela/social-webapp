import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getAttachmentsCollection, getRoomMembersCollection } from "@/lib/db/database";
import { validateUserAuthenticationOrRespond } from "@/lib/server/authMiddleware";
import { blindStableId } from "@/lib/server/privacy";
import { createAttachmentDownloadToken } from "@/lib/server/attachmentToken";
import { isValidAttachmentId, isValidRoomId, isValidSocialId } from "@/lib/validation/schemas";

interface DownloadTokenPayload {
  socialId: string;
  roomId: string;
  attachmentId: string;
}

const TOKEN_TTL_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DownloadTokenPayload;
    const socialId = body.socialId?.trim();
    const roomId = body.roomId?.trim();
    const attachmentId = body.attachmentId?.trim();

    if (!socialId || !roomId || !attachmentId) {
      return NextResponse.json({ success: false, error: "socialId, roomId and attachmentId are required" }, { status: 400 });
    }

    if (!isValidSocialId(socialId) || !isValidRoomId(roomId) || !isValidAttachmentId(attachmentId)) {
      return NextResponse.json({ success: false, error: "Invalid attachment token payload" }, { status: 400 });
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

    const attachment = await attachments.findOne(
      { attachmentId, roomId, expiresAt: { $gt: new Date() } },
      { projection: { _id: 1, expiresAt: 1 } }
    );

    if (!attachment) {
      return NextResponse.json({ success: false, error: "Attachment not found or expired" }, { status: 404 });
    }

    const expiresAtMs = Math.min(
      new Date(String(attachment.expiresAt)).getTime(),
      Date.now() + TOKEN_TTL_MS
    );

    const token = createAttachmentDownloadToken({
      attachmentId,
      roomId,
      socialId,
      exp: expiresAtMs,
    });

    return NextResponse.json({ success: true, token, expiresAt: new Date(expiresAtMs).toISOString() }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
