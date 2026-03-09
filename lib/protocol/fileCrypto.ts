import { bytesToBase64Url } from "@/lib/protocol/base64url";
import { decryptTransportMessage, encryptTransportMessage } from "@/lib/protocol/transportCrypto";

const FILE_IV_LENGTH = 12;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function encryptFileForAttachment(file: File, conversationKey: string): Promise<{
  encryptedBytes: Uint8Array;
  wrappedFileKey: string;
  wrappedFileKeyVersion: number;
  plaintextByteLength: number;
}> {
  const plaintextBytes = new Uint8Array(await file.arrayBuffer());
  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(FILE_IV_LENGTH));

  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(fileKey), { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, cryptoKey, toArrayBuffer(plaintextBytes));
  const encryptedBytes = new Uint8Array(encrypted);
  const packed = new Uint8Array(iv.length + encryptedBytes.length);
  packed.set(iv, 0);
  packed.set(encryptedBytes, iv.length);

  const fileKeyBase64Url = bytesToBase64Url(fileKey);
  const wrappedFileKey = await encryptTransportMessage(fileKeyBase64Url, conversationKey);

  return {
    encryptedBytes: packed,
    wrappedFileKey,
    wrappedFileKeyVersion: 1,
    plaintextByteLength: plaintextBytes.length,
  };
}

export async function decryptDownloadedAttachment(
  encryptedPayload: Uint8Array | ArrayBuffer,
  wrappedFileKey: string,
  conversationKey: string,
  wrappedFileKeyVersion = 1
): Promise<Uint8Array> {
  void wrappedFileKeyVersion;
  const fileKeyBase64Url = await decryptTransportMessage(wrappedFileKey, conversationKey);
  const fileKeyBase64 = fileKeyBase64Url.replace(/-/g, "+").replace(/_/g, "/");
  const fileKeyPadded = fileKeyBase64.padEnd(Math.ceil(fileKeyBase64.length / 4) * 4, "=");
  const fileKey = new Uint8Array(Uint8Array.from(atob(fileKeyPadded), (char) => char.charCodeAt(0)));
  const packed = encryptedPayload instanceof Uint8Array ? encryptedPayload : new Uint8Array(encryptedPayload);

  if (packed.length <= FILE_IV_LENGTH) {
    throw new Error("Invalid encrypted attachment payload");
  }

  const iv = packed.slice(0, FILE_IV_LENGTH);
  const ciphertext = packed.slice(FILE_IV_LENGTH);
  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(fileKey), { name: "AES-GCM" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, cryptoKey, toArrayBuffer(ciphertext));
  return new Uint8Array(decrypted);
}
