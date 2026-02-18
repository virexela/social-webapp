import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

type CloseEventLike = { code: number; reason: string };

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEventLike) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = "blob";

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send() {}

  close() {
    this.onclose?.({ code: 1000, reason: "closed" });
  }
}

describe("RelaySocket", () => {
  const OriginalWebSocket = global.WebSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.instances = [];
    global.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.WebSocket = OriginalWebSocket;
  });

  it("keeps waiting across transient pre-open disconnect and succeeds after reconnect", async () => {
    const { RelaySocket } = require("@/lib/network/socket");
    const socket = new RelaySocket("ws://127.0.0.1:3001/ws");

    const openPromise = socket.connectAndWaitOpen(3000);

    const first = FakeWebSocket.instances[0];
    expect(first).toBeTruthy();
    first.onclose?.({ code: 1006, reason: "" });

    await jest.advanceTimersByTimeAsync(250);

    const second = FakeWebSocket.instances[1];
    expect(second).toBeTruthy();
    second.onopen?.();

    await expect(openPromise).resolves.toBeUndefined();
    socket.close();
  });
});
