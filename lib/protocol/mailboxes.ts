export interface ActiveMailboxes {
  current: Uint8Array;
  previous: Uint8Array | null;
}

export function splitActiveMailboxIds(bytes: Uint8Array): ActiveMailboxes {
  if (bytes.byteLength !== 64) {
    throw new Error("Invalid active mailbox buffer length");
  }
  const current = bytes.slice(0, 32);
  const prev = bytes.slice(32, 64);
  const previous = prev.every((b) => b === 0) ? null : prev;
  return { current, previous };
}
