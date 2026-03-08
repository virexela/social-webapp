import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { RelaySocket } from "@/lib/network/socket";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = jest.fn<void, [string]>();
  close = jest.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  emitClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

describe("RelaySocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    jest.useFakeTimers();
    Object.defineProperty(globalThis, "window", {
      value: globalThis,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("defers close until after a connecting socket opens", () => {
    const socket = new RelaySocket("ws://localhost:8080/ws/room-1");

    socket.connect();

    const rawSocket = MockWebSocket.instances[0];
    expect(rawSocket).toBeDefined();
    expect(rawSocket?.close).not.toHaveBeenCalled();

    socket.close();

    expect(rawSocket?.close).not.toHaveBeenCalled();

    rawSocket?.emitOpen();

    expect(rawSocket?.close).toHaveBeenCalledTimes(1);
  });

  it("backs off reconnect attempts after handshake failures", () => {
    const socket = new RelaySocket("ws://localhost:8080/ws/room-1");

    socket.connect();

    const firstSocket = MockWebSocket.instances[0];
    expect(firstSocket).toBeDefined();

    firstSocket?.emitClose();

    jest.advanceTimersByTime(4_999);
    expect(MockWebSocket.instances).toHaveLength(1);

    jest.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});