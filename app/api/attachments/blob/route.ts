import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseConnection, getAttachmentsCollection, getRoomMembersCollection } from "@/lib/db/database";
import { verifyAttachmentDownloadToken } from "@/lib/server/attachmentToken";
import { blindStableId } from "@/lib/server/privacy";
import { getSessionSocialIdFromRequest } from "@/lib/server/sessionAuth";

function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function buildDownloadName(fileName: string): string {
  const cleaned = fileName.replace(/[\\/\0\r\n]/g, "_").trim();
  return cleaned || "attachment.bin";
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

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token")?.trim();
    if (!token) {
      return NextResponse.json({ success: false, error: "Missing download token" }, { status: 400 });
    }

    const payload = verifyAttachmentDownloadToken(token);
    if (!payload) {
      return NextResponse.json({ success: false, error: "Invalid or expired download token" }, { status: 401 });
    }

    const sessionSocialId = await getSessionSocialIdFromRequest(req);
    if (!sessionSocialId || sessionSocialId !== payload.socialId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    await ensureDatabaseConnection();
    const attachments = getAttachmentsCollection();
    const roomMembers = getRoomMembersCollection();

    const memberId = blindStableId(sessionSocialId);
    const membership = await roomMembers.findOne({ roomId: payload.roomId, memberId }, { projection: { _id: 1 } });
    if (!membership) {
      return NextResponse.json({ success: false, error: "Forbidden: not a room member" }, { status: 403 });
    }

    const attachment = await attachments.findOne(
      {
        attachmentId: payload.attachmentId,
        roomId: payload.roomId,
        expiresAt: { $gt: new Date() },
      },
      { projection: { encryptedBlob: 1, encryptedBlobBase64Url: 1, encryptedByteLength: 1, mimeType: 1, fileName: 1, _id: 0 } }
    );

    if (!attachment?.encryptedBlob && !attachment?.encryptedBlobBase64Url) {
      return NextResponse.json({ success: false, error: "Attachment not found or expired" }, { status: 404 });
    }

    const binary = attachment.encryptedBlob ? toBuffer(attachment.encryptedBlob) : base64UrlToBuffer(String(attachment.encryptedBlobBase64Url));
    const bodyBytes = new Uint8Array(binary);
    const fileName = buildDownloadName(String(attachment.fileName ?? "attachment.bin"));
    const mimeType = String(attachment.mimeType ?? "application/octet-stream");

    return new NextResponse(bodyBytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(Number(attachment.encryptedByteLength ?? bodyBytes.byteLength)),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
