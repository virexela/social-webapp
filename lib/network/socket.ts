
type SocketState = "idle" | "connecting" | "open" | "closed";
type OpenWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

export class RelaySocket {
  private ws: WebSocket | null = null;
  private state: SocketState = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private allowReconnect = true;
  private openWaiters: OpenWaiter[] = [];
  private msgListeners: Array<(msg: unknown) => void> = [];

  constructor(
    private readonly url: string,
    onMessage?: (msg: unknown) => void
  ) {
    if (onMessage) this.msgListeners.push(onMessage);
  }

  addMessageListener(listener: (msg: unknown) => void): () => void {
    this.msgListeners.push(listener);
    return () => {
      this.msgListeners = this.msgListeners.filter((l) => l !== listener);
    };
  }

  connect() {
    if (this.state === "open" || this.state === "connecting") return;
    this.allowReconnect = true;
    this.state = "connecting";

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.state = "open";
      this.reconnectAttempt = 0;
      const waiters = this.openWaiters;
      this.openWaiters = [];
      for (const w of waiters) w.resolve();
    };

    this.ws.onmessage = (evt) => {
      let payload: unknown = evt.data;
      if (typeof evt.data === "string") {
        try {
          payload = JSON.parse(evt.data);
        } catch {
          payload = evt.data;
        }
      }
      for (const l of this.msgListeners) l(payload);
    };

    this.ws.onclose = (evt) => {
      this.state = "closed";
      if (!this.allowReconnect && this.openWaiters.length > 0) {
        const waiters = this.openWaiters;
        this.openWaiters = [];
        const message = evt.reason
          ? `WebSocket closed before open: ${evt.reason}`
          : `WebSocket closed before open (code ${evt.code})`;
        for (const w of waiters) w.reject(new Error(message));
      }
      if (this.allowReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // Safari may emit transient error events; rely on onclose for reconnect.
    };
  }

  async connectAndWaitOpen(timeoutMs = 5000): Promise<void> {
    if (this.state === "open") return;

    this.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error("WebSocket open timed out"));
      }, timeoutMs);

      this.openWaiters.push({
        resolve: () => {
          window.clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      });
      const currentWs = this.ws;
      if (!currentWs) {
        window.clearTimeout(timer);
        reject(new Error("WebSocket initialization failed"));
      }
    });
  }

  close() {
    this.allowReconnect = false;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.openWaiters.length > 0) {
      const waiters = this.openWaiters;
      this.openWaiters = [];
      for (const w of waiters) w.reject(new Error("WebSocket closed"));
    }
    this.state = "closed";
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect() {
    if (!this.allowReconnect) return;
    if (this.reconnectTimer) return;
    const attempt = this.reconnectAttempt++;
    const delayMs = Math.min(30_000, 250 * 2 ** attempt);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private sendText(text: string) {
    if (!this.ws || this.state !== "open") {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(text);
  }

  // send a JSON message to the server
  sendJson(obj: unknown) {
    this.sendText(JSON.stringify(obj));
  }
}
