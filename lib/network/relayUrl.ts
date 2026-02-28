function ensureWsPath(base: string): string {
  // ensure the URL always ends with "/ws", adding the slash if needed
  if (base.endsWith("/ws")) return base;
  return base.replace(/\/?$/, "/ws");
}

export function getRelayWsUrl(): string {
  const isDev = process.env.NODE_ENV !== "production";
  let base =
    process.env.NEXT_PUBLIC_RELAY_WS_URL ??
    process.env.NEXT_PUBLIC_WS_URL ??
    "ws://localhost:3001/ws";

  if (isDev && typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host) {
      try {
        const parsed = new URL(base);
        if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
          parsed.hostname = host;
          base = parsed.toString();
        }
      } catch {
        // fallback when the env value isn’t a valid URL
        base = `ws://${host}:3001`;
      }
    }
  }

  if (!isDev) {
    try {
      const parsed = new URL(base);
      if (parsed.protocol === "ws:" || parsed.protocol === "http:") parsed.protocol = "wss:";
      if (parsed.protocol === "https:") parsed.protocol = "wss:";
      base = parsed.toString();
    } catch {
      // keep original if malformed; caller will fail fast on websocket creation
    }
  }

  return ensureWsPath(base);
}

export function getRelayWsUrlCandidates(): string[] {
  const primary = getRelayWsUrl();
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return [primary];
  }

  const host = window.location.hostname || "localhost";
  const hosts = [host, "127.0.0.1", "localhost"];
  const candidates = hosts.map(h => `ws://${h}:3001/ws`);

  // prepend primary and dedupe via Set to preserve order
  return Array.from(new Set([primary, ...candidates].map(ensureWsPath)));
}
