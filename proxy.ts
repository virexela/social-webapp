import { NextRequest, NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const API_LIMIT_PER_WINDOW = 240;

type Counter = { count: number; resetAt: number };

const counters = new Map<string, Counter>();

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
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

function maybeCleanupCounters() {
  if (counters.size < 1000) return;
  const now = Date.now();
  for (const [key, value] of counters.entries()) {
    if (value.resetAt <= now) counters.delete(key);
  }
}

export function proxy(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith("/api/")) {
    maybeCleanupCounters();
    const ip = getClientIp(req);
    const { limited, retryAfterSec } = isRateLimited(`${ip}:${pathname}`);
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
  if (pathname.startsWith("/api/")) {
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Content-Type-Options", "nosniff");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
