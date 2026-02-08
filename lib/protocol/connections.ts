export function splitConnectionIds(bytes: Uint8Array): Uint8Array[] {
  if (bytes.byteLength % 16 !== 0) {
    throw new Error("Invalid connection id buffer length");
  }

  const result: Uint8Array[] = [];
  for (let i = 0; i < bytes.byteLength; i += 16) {
    result.push(bytes.slice(i, i + 16));
  }
  return result;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
