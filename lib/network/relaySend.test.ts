import { describe, expect, it, jest } from "@jest/globals";

const getActiveMailboxIdsMock = jest.fn(async () => {
  const out = new Uint8Array(64);
  out.fill(1, 0, 32);
  return out;
});

jest.mock("@/lib/crypto", () => ({
  getCrypto: () => ({
    get_active_mailbox_ids: getActiveMailboxIdsMock,
  }),
}));

const { sendCiphertextBlob } = require("@/lib/network/relaySend");

describe("sendCiphertextBlob", () => {
  it("uses current mailbox id from WASM and sends payload", async () => {
    const sendPutMessage = jest.fn();
    const socket = { sendPutMessage } as unknown as {
      sendPutMessage: (mailboxId: Uint8Array, blob: Uint8Array) => void;
    };
    const connectionId = new Uint8Array(16).fill(2);
    const ciphertext = new Uint8Array([9, 8, 7]);

    await sendCiphertextBlob(socket as never, connectionId, ciphertext);

    expect(getActiveMailboxIdsMock).toHaveBeenCalledWith(connectionId);
    expect(sendPutMessage).toHaveBeenCalledTimes(1);
    const [mailboxId, blob] = sendPutMessage.mock.calls[0] as [Uint8Array, Uint8Array];
    expect(mailboxId.byteLength).toBe(32);
    expect(Array.from(blob)).toEqual([9, 8, 7]);
  });
});
