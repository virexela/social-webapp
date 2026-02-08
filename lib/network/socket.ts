import { encodeEnvelope } from "@/lib/protocol/envelope";

type SocketState = "idle" | "connecting" | "open" | "closed";

export class RelaySocket {
  private ws: WebSocket | null = null;
  private state: SocketState = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private openWaiters: Array<() => void> = [];
  private frameListeners: Array<(frame: Uint8Array) => void> = [];

  constructor(
    private readonly url: string,
    onFrame?: (frame: Uint8Array) => void
  ) {
    if (onFrame) this.frameListeners.push(onFrame);
  }

  addFrameListener(listener: (frame: Uint8Array) => void): () => void {
    this.frameListeners.push(listener);
    return () => {
      this.frameListeners = this.frameListeners.filter((l) => l !== listener);
    };
  }

  connect() {
    if (this.state === "open" || this.state === "connecting") return;
    this.state = "connecting";

    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.state = "open";
      this.reconnectAttempt = 0;
      const waiters = this.openWaiters;
      this.openWaiters = [];
      for (const w of waiters) w();
    };

    this.ws.onmessage = (evt) => {
      if (!(evt.data instanceof ArrayBuffer)) return;
      const frame = new Uint8Array(evt.data);
      for (const l of this.frameListeners) l(frame);
    };

    this.ws.onclose = () => {
      this.state = "closed";
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // Close triggers reconnect.
      try {
        this.ws?.close();
      } catch {
        // ignore
      }
    };
  }

  async connectAndWaitOpen(timeoutMs = 5000): Promise<void> {
    if (this.state === "open") return;

    this.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error("WebSocket open timed out"));
      }, timeoutMs);

      this.openWaiters.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  close() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.openWaiters = [];
    this.state = "closed";
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const attempt = this.reconnectAttempt++;
    const delayMs = Math.min(30_000, 250 * 2 ** attempt);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private sendFrame(frame: Uint8Array) {
    if (!this.ws || this.state !== "open") {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(frame);
  }

  // Binary frames only. JS does not parse payload semantics.
  sendPutMessage(mailboxId: Uint8Array, blob: Uint8Array) {
    const payload = new Uint8Array(mailboxId.byteLength + blob.byteLength);
    payload.set(mailboxId, 0);
    payload.set(blob, mailboxId.byteLength);
    this.sendFrame(encodeEnvelope({ opcode: 1, payload }));
  }

  fetchMessages(mailboxId: Uint8Array) {
    this.sendFrame(encodeEnvelope({ opcode: 2, payload: mailboxId }));
  }

  deleteMessages(mailboxId: Uint8Array, ids: Uint8Array[]) {
    const total = ids.reduce((sum, id) => sum + 4 + id.byteLength, 0);
    const payload = new Uint8Array(mailboxId.byteLength + total);
    payload.set(mailboxId, 0);
    const view = new DataView(payload.buffer);
    let offset = mailboxId.byteLength;
    for (const id of ids) {
      view.setUint32(offset, id.byteLength, true);
      offset += 4;
      payload.set(id, offset);
      offset += id.byteLength;
    }
    this.sendFrame(encodeEnvelope({ opcode: 3, payload }));
  }
}
