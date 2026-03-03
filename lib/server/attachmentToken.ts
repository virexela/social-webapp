import { createHmac, timingSafeEqual } from "crypto";

const ATTACHMENT_TOKEN_SECRET = process.env.ATTACHMENT_TOKEN_SECRET?.trim() || process.env.SESSION_HASH_PEPPER?.trim() || "dev_attachment_secret";

interface AttachmentTokenPayload {
  attachmentId: string;
  roomId: string;
  socialId: string;
  exp: number;
}

function toBase64Url(value: Buffer | string): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function sign(payloadSegment: string): string {
  const signature = createHmac("sha256", ATTACHMENT_TOKEN_SECRET).update(payloadSegment).digest();
  return toBase64Url(signature);
}

export function createAttachmentDownloadToken(payload: AttachmentTokenPayload): string {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyAttachmentDownloadToken(token: string): AttachmentTokenPayload | null {
  const [payloadSegment, signature] = token.split(".");
  if (!payloadSegment || !signature) return null;

  const expectedSignature = sign(payloadSegment);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const providedBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payloadSegment).toString("utf8")) as AttachmentTokenPayload;
    if (!parsed?.attachmentId || !parsed?.roomId || !parsed?.socialId) return null;
    if (!Number.isFinite(parsed.exp) || parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
