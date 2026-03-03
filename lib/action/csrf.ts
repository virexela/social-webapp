const CSRF_COOKIE_NAME = "csrf_token";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (!part.startsWith(`${name}=`)) continue;
    return decodeURIComponent(part.slice(name.length + 1));
  }
  return null;
}

export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE_NAME);
}

export function attachCsrfHeader(init: RequestInit = {}): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return init;
  }

  const token = getCsrfToken();
  if (!token) return init;

  const headers = new Headers(init.headers ?? {});
  if (!headers.has("X-CSRF-Token")) {
    headers.set("X-CSRF-Token", token);
  }

  return {
    ...init,
    headers,
  };
}
