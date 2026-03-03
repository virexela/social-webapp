import { NextRequest, NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const API_LIMIT_PER_WINDOW = 240;
const MAX_API_CONTENT_LENGTH = 2_200_000;
const MAX_ATTACHMENT_UPLOAD_CONTENT_LENGTH = 40_000_000;
const CSRF_COOKIE_NAME = "csrf_token";

type Counter = { count: number; resetAt: number };

const counters = new Map<string, Counter>();
const RATE_LIMIT_REDIS_URL = process.env.RATE_LIMIT_REDIS_REST_URL?.trim();
const RATE_LIMIT_REDIS_TOKEN = process.env.RATE_LIMIT_REDIS_REST_TOKEN?.trim();

function looksLikeIp(value: string): boolean {
  if (!value || value.length > 64) return false;
  // Accept IPv4, IPv6 (possibly with mapped prefix), and bracketless forms.
  return /^[0-9a-fA-F:.]+$/.test(value);
}

function normalizeClientIp(req: NextRequest): string | null {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp && looksLikeIp(realIp)) return realIp;

  if (process.env.TRUST_X_FORWARDED_FOR === "1") {
    const forwarded = req.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first && looksLikeIp(first)) return first;
  }

  return null;
}

function hashKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function getRateLimitKey(req: NextRequest, pathname: string): string {
  const sessionToken = req.cookies.get("social_session")?.value?.trim();
  if (sessionToken && sessionToken.length >= 20 && sessionToken.length <= 512) {
    return `session:${hashKey(sessionToken)}:${pathname}`;
  }

  const ip = normalizeClientIp(req);
  if (ip) {
    return `ip:${ip}:${pathname}`;
  }

  const ua = req.headers.get("user-agent") ?? "unknown";
  return `anon:${hashKey(ua)}:${pathname}`;
}

function isRateLimited(key: string): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = counters.get(key);
  if (!existing || existing.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false, retryAfterSec: Math.ceil(WINDOW_MS / 1000) };
  }

  if (existing.count >= API_LIMIT_PER_WINDOW) {
    return { limited: true, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }

  existing.count += 1;
  counters.set(key, existing);
  return { limited: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
}

async function isRateLimitedDistributed(key: string): Promise<{ limited: boolean; retryAfterSec: number }> {
  if (!RATE_LIMIT_REDIS_URL || !RATE_LIMIT_REDIS_TOKEN) {
    return isRateLimited(key);
  }

  const now = Date.now();
  const resetAt = now + WINDOW_MS;
  const ttlSeconds = Math.ceil(WINDOW_MS / 1000);
  const encodedKey = encodeURIComponent(`rl:webapp:${key}`);

  try {
    // Best-effort distributed counter using Redis REST INCR/EXPIRE pattern.
    const incrRes = await fetch(`${RATE_LIMIT_REDIS_URL}/incr/${encodedKey}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${RATE_LIMIT_REDIS_TOKEN}` },
      cache: "no-store",
    });
    if (!incrRes.ok) {
      return isRateLimited(key);
    }

    const incrJson = (await incrRes.json()) as { result?: number };
    const count = Number(incrJson?.result ?? 0);
    if (count === 1) {
      await fetch(`${RATE_LIMIT_REDIS_URL}/expire/${encodedKey}/${ttlSeconds}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${RATE_LIMIT_REDIS_TOKEN}` },
        cache: "no-store",
      });
    }

    if (count > API_LIMIT_PER_WINDOW) {
      return { limited: true, retryAfterSec: ttlSeconds };
    }
    return { limited: false, retryAfterSec: Math.ceil((resetAt - now) / 1000) };
  } catch {
    return isRateLimited(key);
  }
}

function maybeCleanupCounters() {
  if (counters.size < 1000) return;
  const now = Date.now();
  for (const [key, value] of counters.entries()) {
    if (value.resetAt <= now) counters.delete(key);
  }
}

export async function proxy(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const pathname = req.nextUrl.pathname;
  const method = req.method.toUpperCase();
  const isApi = pathname.startsWith("/api/");

  const incomingCsrf = req.cookies.get(CSRF_COOKIE_NAME)?.value?.trim();
  const csrfToken = incomingCsrf || crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  if (isApi) {
    const maxContentLength = pathname.startsWith("/api/attachments/upload")
      ? MAX_ATTACHMENT_UPLOAD_CONTENT_LENGTH
      : MAX_API_CONTENT_LENGTH;
    const contentLengthRaw = req.headers.get("content-length");
    if (contentLengthRaw) {
      const contentLength = Number(contentLengthRaw);
      if (Number.isFinite(contentLength) && contentLength > maxContentLength) {
        const tooLarge = NextResponse.json(
          { success: false, error: "payload_too_large", requestId },
          { status: 413, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } }
        );
        if (!incomingCsrf) {
          tooLarge.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
            httpOnly: false,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
          });
        }
        return tooLarge;
      }
    }

    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      const csrfHeader = req.headers.get("x-csrf-token")?.trim();
      const origin = req.headers.get("origin")?.trim();
      const host = req.headers.get("host")?.trim();
      let validOrigin = true;
      if (origin && host) {
        try {
          validOrigin = new URL(origin).host === host;
        } catch {
          validOrigin = false;
        }
      }
      if (!incomingCsrf || !csrfHeader || incomingCsrf !== csrfHeader || !validOrigin) {
        const forbidden = NextResponse.json(
          { success: false, error: "csrf_validation_failed", requestId },
          { status: 403, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } }
        );
        forbidden.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
          httpOnly: false,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
        });
        return forbidden;
      }
    }

    maybeCleanupCounters();
    const key = getRateLimitKey(req, pathname);
    const { limited, retryAfterSec } = await isRateLimitedDistributed(key);
    if (limited) {
      return NextResponse.json(
        { success: false, error: "too_many_requests", requestId },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "Cache-Control": "no-store",
            "X-Request-ID": requestId,
          },
        }
      );
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Request-ID", requestId);
  if (!incomingCsrf) {
    res.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  if (isApi) {
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Content-Type-Options", "nosniff");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
