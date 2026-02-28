import { hexToBytes } from "@/lib/protocol/bytes";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/protocol/base64url";

const IV_LENGTH = 12;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importRecoveryKeyFromStorage(): Promise<CryptoKey> {
  const recoveryHex = localStorage.getItem("recovery_key")?.trim();
  if (!recoveryHex) {
    throw new Error("Missing recovery key");
  }

  const keyBytes = hexToBytes(recoveryHex);
  if (keyBytes.length !== 32) {
    throw new Error("Invalid recovery key");
  }

  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptMessageForStorage(plaintext: string): Promise<string> {
  const key = await importRecoveryKeyFromStorage();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plainBytes = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plainBytes)
  );
  const cipherBytes = new Uint8Array(encrypted);

  const packed = new Uint8Array(iv.length + cipherBytes.length);
  packed.set(iv, 0);
  packed.set(cipherBytes, iv.length);

  return bytesToBase64Url(packed);
}

export async function decryptMessageFromStorage(payload: string): Promise<string> {
  const key = await importRecoveryKeyFromStorage();
  const packed = base64UrlToBytes(payload);

  if (packed.length <= IV_LENGTH) {
    throw new Error("Invalid encrypted payload");
  }

  const iv = packed.slice(0, IV_LENGTH);
  const cipherBytes = packed.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(cipherBytes)
  );
  return new TextDecoder().decode(decrypted);
}
