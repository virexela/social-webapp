import type { NextConfig } from "next";

const DEFAULT_DEV_RELAY_WS_URL = "ws://localhost:3001/ws";
const DEFAULT_PROD_RELAY_WS_URL =
  "wss://social.delightfulrock-2e220617.centralindia.azurecontainerapps.io/ws";

function relayConnectSrc(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const fallback = isDev ? DEFAULT_DEV_RELAY_WS_URL : DEFAULT_PROD_RELAY_WS_URL;
  const raw = process.env.NEXT_PUBLIC_RELAY_WS_URL ?? fallback;
  const sources = new Set<string>();

  if (isDev) {
    // Keep explicit local relay hosts allowed for Safari/dev workflows.
    sources.add("ws://localhost:3001");
    sources.add("http://localhost:3001");
    sources.add("ws://127.0.0.1:3001");
    sources.add("http://127.0.0.1:3001");
    // Allow LAN relay host testing from phones/tablets in development.
    sources.add("ws:");
    sources.add("http:");
  }

  try {
    const parsed = new URL(raw);
    const secure = parsed.protocol === "https:" || parsed.protocol === "wss:";
    const wsProtocol = secure ? "wss:" : "ws:";
    const httpProtocol = secure ? "https:" : "http:";
    sources.add(`${wsProtocol}//${parsed.host}`);
    sources.add(`${httpProtocol}//${parsed.host}`);
    return Array.from(sources).join(" ");
  } catch {
    sources.add("wss://social.delightfulrock-2e220617.centralindia.azurecontainerapps.io");
    sources.add("https://social.delightfulrock-2e220617.centralindia.azurecontainerapps.io");
    return Array.from(sources).join(" ");
  }
}

function buildCsp(): string {
  const isDev = process.env.NODE_ENV !== "production";

  // Next.js (especially in dev) injects some inline scripts/styles.
  // We keep the CSP strict where possible, but allow the minimum needed
  // for the framework runtime.
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
    `connect-src 'self' ${relayConnectSrc()}`,
  ].join("; ");
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildCsp(),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
