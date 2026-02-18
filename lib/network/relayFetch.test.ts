import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { encodeEnvelope } from "@/lib/protocol/envelope";

const getActiveMailboxIdsMock = jest.fn(async () => {
  const out = new Uint8Array(64);
  out.fill(3, 0, 32); // current
  out.fill(4, 32, 64); // previous
  return out;
});

jest.mock("@/lib/crypto", () => ({
  getCrypto: () => ({
    get_active_mailbox_ids: getActiveMailboxIdsMock,
  }),
}));

const { fetchCiphertextBlobs } = require("@/lib/network/relayFetch");

describe("fetchCiphertextBlobs", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("fetches both mailboxes and returns opcode=2 payloads", async () => {
    const listeners: Array<(frame: Uint8Array) => void> = [];
    const addFrameListener = jest.fn((listener: (frame: Uint8Array) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    });
    const fetchMessages = jest.fn();

    const socket = {
      addFrameListener,
      fetchMessages,
    } as unknown as {
      addFrameListener: (listener: (frame: Uint8Array) => void) => () => void;
      fetchMessages: (mailboxId: Uint8Array) => void;
    };

    const promise = fetchCiphertextBlobs(socket as never, new Uint8Array(16).fill(2), {
      timeoutMs: 25,
    });
    await Promise.resolve();

    // Simulate relay frames while listener is active.
    listeners[0]?.(encodeEnvelope({ opcode: 2, payload: new Uint8Array([1, 2, 3]) }));
    listeners[0]?.(encodeEnvelope({ opcode: 1, payload: new Uint8Array([9]) })); // ignored
    listeners[0]?.(encodeEnvelope({ opcode: 2, payload: new Uint8Array([4]) }));

    await jest.advanceTimersByTimeAsync(25);
    const blobs = await promise;

    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect(blobs.map((b) => Array.from(b))).toEqual([[1, 2, 3], [4]]);
  });
});
