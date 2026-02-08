import { getCrypto } from "@/lib/crypto";
import type { ConnectionId } from "@/lib/crypto";
import { decodeEnvelope } from "@/lib/protocol/envelope";
import { splitActiveMailboxIds } from "@/lib/protocol/mailboxes";
import type { RelaySocket } from "./socket";

export interface FetchCiphertextOptions {
  timeoutMs?: number;
}

// Fetches ciphertext blobs for the current + previous mailbox.
// JS does not parse SOCM envelopes; it only unwraps the relay's outer envelope.
export async function fetchCiphertextBlobs(
  socket: RelaySocket,
  connectionId: ConnectionId,
  opts: FetchCiphertextOptions = {}
): Promise<Uint8Array[]> {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const crypto = getCrypto();

  const active = await crypto.get_active_mailbox_ids(connectionId);
  const { current, previous } = splitActiveMailboxIds(active);

  const blobs: Uint8Array[] = [];

  const unsub = socket.addFrameListener((frame) => {
    try {
      const env = decodeEnvelope(frame);
      // Convention: relay responds to fetch with opcode=2 where payload is a ciphertext blob.
      if (env.opcode === 2 && env.payload.byteLength > 0) {
        blobs.push(env.payload);
      }
    } catch {
      // ignore malformed frames
    }
  });

  try {
    socket.fetchMessages(current);
    if (previous) socket.fetchMessages(previous);

    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), timeoutMs);
    });

    return blobs;
  } finally {
    unsub();
  }
}
