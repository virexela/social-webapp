export interface WrappedBlob {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Ensure an ArrayBuffer (not SharedArrayBuffer) for SubtleCrypto typings.
  const copy = bytes.slice();
  return copy.buffer;
}

function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const ab = toArrayBuffer(bytes) as ArrayBuffer;
  return new Uint8Array(ab);
}

export async function wrapBytesAesGcm(
  wrappingKey: CryptoKey,
  plaintext: Uint8Array
): Promise<WrappedBlob> {
  const iv = toArrayBufferView(crypto.getRandomValues(new Uint8Array(12)));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      wrappingKey,
      toArrayBuffer(plaintext)
    )
  );
  return { iv, ciphertext };
}

export async function unwrapBytesAesGcm(
  wrappingKey: CryptoKey,
  wrapped: WrappedBlob
): Promise<Uint8Array> {
  const iv = toArrayBufferView(wrapped.iv);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    toArrayBuffer(wrapped.ciphertext)
  );
  return new Uint8Array(pt);
}
