import type { NextConfig } from "next";
import crypto from "crypto";

const isProd = process.env.NODE_ENV === "production";

// Generate nonce for each request to enable CSP without unsafe-inline
function generateCspNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    const nonce = generateCspNonce();

    const cspHeaders = [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `style-src 'self' 'nonce-${nonce}'`,
      `script-src 'self' 'nonce-${nonce}'`,
      // Restrict connect-src to HTTPS only (no ws:// unencrypted websockets)
      `connect-src 'self' https: wss: ${process.env.NEXT_PUBLIC_RELAY_WS_URL || ""}`,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ];

    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()" },
      {
        key: "Content-Security-Policy",
        value: cspHeaders.join("; "),
      },
    ];

    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }] : []),
          // Required for nonce to work properly in Next.js
          { key: "X-CSP-Nonce", value: nonce },
        ],
      },
    ];
  },
};

export default nextConfig;
