import type { NextConfig } from "next";

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
    "connect-src 'self' wss://social.delightfulrock-2e220617.centralindia.azurecontainerapps.io",
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
