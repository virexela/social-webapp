import { NextRequest } from "next/server";

export async function parseJsonObject(req: NextRequest): Promise<Record<string, unknown>> {
  const body = (await req.json()) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid JSON payload");
  }
  return body as Record<string, unknown>;
}

export function readTrimmedString(body: Record<string, unknown>, key: string): string | null {
  const raw = body[key];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}
