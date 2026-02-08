export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.toLowerCase().replace(/^0x/, "").replaceAll(/\s+/g, "");
  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex: length must be even");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = normalized.slice(i * 2, i * 2 + 2);
    const val = Number.parseInt(byte, 16);
    if (Number.isNaN(val)) throw new Error("Invalid hex: contains non-hex chars");
    out[i] = val;
  }
  return out;
}
