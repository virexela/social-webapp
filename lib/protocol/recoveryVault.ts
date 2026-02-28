import { hexToBytes } from "@/lib/protocol/bytes";

export type BackendKeyEnvelope = {
  v: 1;
  alg: "aes-256-gcm";
  ivHex: string;
  ciphertextHex: string;
  tagHex: string;
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function validateRecoveryKeyHex(recoveryKeyHex: string): Uint8Array {
  const bytes = hexToBytes(recoveryKeyHex.trim());
  if (bytes.length !== 32) {
    throw new Error("Recovery key must be 32 bytes");
  }
  return bytes;
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Secure crypto is unavailable on this device/browser context. Open the app on HTTPS (or localhost) and try again."
    );
  }
  return subtle;
}

export async function deriveRecoveryAuthHash(recoveryKeyHex: string): Promise<string> {
  const recoveryKey = validateRecoveryKeyHex(recoveryKeyHex);
  const subtle = getSubtleCrypto();
  const digest = await subtle.digest("SHA-256", toArrayBuffer(recoveryKey));
  return bytesToHex(new Uint8Array(digest));
}

export async function signAccountChallenge(
  recoveryKeyHex: string,
  action: "clear-data" | "delete-user",
  socialId: string,
  nonce: string
): Promise<string> {
  const recoveryAuthHash = await deriveRecoveryAuthHash(recoveryKeyHex);
  const keyBytes = hexToBytes(recoveryAuthHash);
  const subtle = getSubtleCrypto();
  const cryptoKey = await subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const payload = `${action}:${socialId}:${nonce}`;
  const signature = await subtle.sign("HMAC", cryptoKey, toArrayBuffer(new TextEncoder().encode(payload)));
  return bytesToHex(new Uint8Array(signature));
}

export async function createBackendKeyEnvelope(recoveryKeyHex: string): Promise<BackendKeyEnvelope> {
  const recoveryKey = validateRecoveryKeyHex(recoveryKeyHex);
  const backendKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const subtle = getSubtleCrypto();

  const recoveryCryptoKey = await subtle.importKey(
    "raw",
    toArrayBuffer(recoveryKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const encrypted = await subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    recoveryCryptoKey,
    toArrayBuffer(backendKey)
  );

  const encryptedBytes = new Uint8Array(encrypted);
  if (encryptedBytes.length < 16) {
    throw new Error("Invalid encrypted backend key");
  }

  const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - 16);
  const tag = encryptedBytes.slice(encryptedBytes.length - 16);

  return {
    v: 1,
    alg: "aes-256-gcm",
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(ciphertext),
    tagHex: bytesToHex(tag),
  };
}
