import { NextRequest } from "next/server";

/**
 * Structured logging utility for the application.
 * All logs are formatted as JSON for easy parsing by log aggregation tools.
 */

export interface LogContext {
  requestId?: string;
  userId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
  [key: string]: unknown;
}

/**
 * List of sensitive keys that should be redacted from logs.
 */
const SENSITIVE_KEYS = [
  "password",
  "secret",
  "token",
  "key",
  "auth",
  "apikey",
  "authorization",
  "bearer",
  "private",
  "nonce",
  "signature",
];

/**
 * Recursively redact sensitive information from an object.
 */
function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive));

    if (isSensitive) {
      redacted[key] = "***REDACTED***";
    } else if (typeof value === "object") {
      redacted[key] = redactSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Generate a unique request ID for tracing.
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract client IP from request, considering reverse proxies.
 */
export function getClientIpFromRequest(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * Log an API request.
 */
export function logRequest(
  req: NextRequest,
  context: Omit<LogContext, "method" | "endpoint"> = {}
): LogContext {
  const requestId = generateRequestId();
  const clientIp = getClientIpFromRequest(req);

  const logData = {
    timestamp: new Date().toISOString(),
    level: "info",
    type: "request",
    requestId,
    method: req.method,
    endpoint: req.nextUrl.pathname,
    clientIp,
    userAgent: req.headers.get("user-agent"),
    ...context,
  };

  console.log(JSON.stringify(redactSensitiveData(logData)));
  return { requestId, ...context };
}

/**
 * Log an API response.
 */
export function logResponse(
  requestId: string,
  statusCode: number,
  duration: number,
  context: LogContext = {}
): void {
  const logData = {
    timestamp: new Date().toISOString(),
    level: statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info",
    type: "response",
    requestId,
    statusCode,
    duration,
    ...context,
  };

  console.log(JSON.stringify(logData));
}

/**
 * Log an authentication event.
 */
export function logAuthEvent(
  type: "success" | "failure",
  userId: string,
  reason?: string,
  context: LogContext = {}
): void {
  const logData = {
    timestamp: new Date().toISOString(),
    level: type === "failure" ? "warn" : "info",
    type: "auth",
    authType: type,
    userId,
    reason,
    ...context,
  };

  console.log(JSON.stringify(redactSensitiveData(logData)));
}

/**
 * Log a security event (rate limit, validation error, etc).
 */
export function logSecurityEvent(
  eventType: "rate_limit" | "validation_error" | "unauthorized" | "forbidden",
  context: LogContext = {}
): void {
  const logData = {
    timestamp: new Date().toISOString(),
    level: "warn",
    type: "security",
    eventType,
    ...context,
  };

  console.log(JSON.stringify(logData));
}

/**
 * Log an error.
 */
export function logError(
  error: Error | unknown,
  context: LogContext = {}
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const logData = {
    timestamp: new Date().toISOString(),
    level: "error",
    type: "error",
    message: errorMessage,
    stack: stack?.split("\n").slice(0, 5),
    ...context,
  };

  console.error(JSON.stringify(redactSensitiveData(logData)));
}

/**
 * Middleware to add request tracking to API responses.
 */
export function withRequestTracking(
  handler: (req: NextRequest, context: LogContext) => Promise<Response>
) {
  return async (req: NextRequest): Promise<Response> => {
    const context = logRequest(req);
    const startTime = Date.now();

    try {
      const response = await handler(req, context);
      const duration = Date.now() - startTime;

      // Only log response for error codes in production
      if (process.env.NODE_ENV !== "production" || response.status >= 400) {
        logResponse(context.requestId || "unknown", response.status, duration, context);
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(error, { ...context, duration });
      throw error;
    }
  };
}
