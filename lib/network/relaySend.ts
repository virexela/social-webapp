import { getCrypto } from "@/lib/crypto";
import type { ConnectionId } from "@/lib/crypto";
import { splitActiveMailboxIds } from "@/lib/protocol/mailboxes";
import type { RelaySocket } from "./socket";

// JS must not store/display/log mailbox IDs.
// This helper keeps mailbox IDs transient and scoped to the send call.
export async function sendCiphertextBlob(
  socket: RelaySocket,
  connectionId: ConnectionId,
  ciphertextBlob: Uint8Array
) {
  const crypto = getCrypto();
  const active = await crypto.get_active_mailbox_ids(connectionId);
  const { current } = splitActiveMailboxIds(active);
  socket.sendPutMessage(current, ciphertextBlob);
}
