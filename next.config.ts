import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    const cspHeaders = [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
      // Allow ws: only in development for local relay/dev server workflows.
      `connect-src 'self' https: wss:${isProd ? "" : " ws:"} ${process.env.NEXT_PUBLIC_RELAY_WS_URL || ""}`,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "form-action 'self'",
      ...(isProd ? ["upgrade-insecure-requests"] : []),
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
        ],
      },
    ];
  },
};

export default nextConfig;
