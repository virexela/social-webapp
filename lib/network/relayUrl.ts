const DEFAULT_DEV_RELAY_BASE = "ws://127.0.0.1:3001";
const DEFAULT_PROD_RELAY_BASE =
  "wss://social.delightfulrock-2e220617.centralindia.azurecontainerapps.io";

function ensureWsPath(base: string): string {
  if (base.endsWith("/ws")) return base;
  if (base.endsWith("/")) return `${base}ws`;
  return `${base}/ws`;
}

export function getRelayWsUrl(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const fallback = isDev ? DEFAULT_DEV_RELAY_BASE : DEFAULT_PROD_RELAY_BASE;
  let base = process.env.NEXT_PUBLIC_RELAY_WS_URL ?? fallback;

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
        base = `ws://${host}:3001`;
      }
    }
  }

  return ensureWsPath(base);
}

export function getRelayWsUrlCandidates(): string[] {
  const primary = getRelayWsUrl();
  const out: string[] = [primary];

  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return out;
  }

  const host = window.location.hostname || "localhost";
  const candidates = [
    `ws://${host}:3001/ws`,
    "ws://127.0.0.1:3001/ws",
    "ws://localhost:3001/ws",
  ];

  for (const c of candidates) {
    const normalized = ensureWsPath(c);
    if (!out.includes(normalized)) out.push(normalized);
  }

  return out;
}
