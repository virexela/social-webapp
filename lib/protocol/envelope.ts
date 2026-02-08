export type Opcode = 1 | 2 | 3;

export interface Envelope {
  opcode: Opcode;
  payload: Uint8Array;
}

// Minimal binary envelope: [opcode:1][payload_len:4 LE][payload:bytes]
export function encodeEnvelope(env: Envelope): Uint8Array {
  const header = new Uint8Array(1 + 4);
  header[0] = env.opcode;
  const view = new DataView(header.buffer);
  view.setUint32(1, env.payload.byteLength, true);

  const out = new Uint8Array(header.byteLength + env.payload.byteLength);
  out.set(header, 0);
  out.set(env.payload, header.byteLength);
  return out;
}

export function decodeEnvelope(frame: Uint8Array): Envelope {
  if (frame.byteLength < 5) throw new Error("Invalid envelope: too short");
  const opcode = frame[0] as Opcode;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const len = view.getUint32(1, true);
  if (frame.byteLength !== 5 + len) {
    throw new Error("Invalid envelope: length mismatch");
  }
  return { opcode, payload: frame.slice(5) };
}
