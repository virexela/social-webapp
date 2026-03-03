import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

type EncryptedValue = {
  v: 1;
  alg: "aes-256-gcm";
  ivHex: string;
  ciphertextHex: string;
  tagHex: string;
};

function getKey(): Buffer | null {
  const raw = process.env.PUSH_DATA_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const b = Buffer.from(raw, "base64");
  if (b.length === 32) return b;
  throw new Error("PUSH_DATA_ENCRYPTION_KEY must be 32-byte hex or base64");
}

export function hashField(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function encryptField(value: string): EncryptedValue | null {
  const key = getKey();
  if (!key) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    ivHex: iv.toString("hex"),
    ciphertextHex: ciphertext.toString("hex"),
    tagHex: tag.toString("hex"),
  };
}

export function decryptField(
  encrypted: EncryptedValue | null | undefined,
  fallbackPlaintext: string | null | undefined = null
): string | null {
  if (!encrypted) return fallbackPlaintext ?? null;

  const key = getKey();
  if (!key) return fallbackPlaintext ?? null;
  if (encrypted.v !== 1 || encrypted.alg !== "aes-256-gcm") {
    return fallbackPlaintext ?? null;
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(encrypted.tagHex, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertextHex, "hex")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    return fallbackPlaintext ?? null;
  }
}
