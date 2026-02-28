import { hexToBytes } from "@/lib/protocol/bytes";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/protocol/base64url";

const IV_LENGTH = 12;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveTransportKey(conversationKeyHex: string): Promise<CryptoKey> {
  const keyMaterial = hexToBytes(conversationKeyHex.trim());
  if (keyMaterial.length === 0) {
    throw new Error("Missing conversation key");
  }

  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(keyMaterial));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptTransportMessage(plaintext: string, conversationKeyHex: string): Promise<string> {
  const key = await deriveTransportKey(conversationKeyHex);
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

export async function decryptTransportMessage(ciphertext: string, conversationKeyHex: string): Promise<string> {
  const key = await deriveTransportKey(conversationKeyHex);
  const packed = base64UrlToBytes(ciphertext);

  if (packed.length <= IV_LENGTH) {
    throw new Error("Invalid encrypted transport payload");
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
