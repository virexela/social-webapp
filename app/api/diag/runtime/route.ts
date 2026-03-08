import { NextResponse } from "next/server";
import { ensureDatabaseConnection, getDatabaseDiagnostics, getDb } from "@/lib/db/database";
import { validateServerConfig } from "@/lib/server/config";

function getRelaySecretStatus(): string {
  const relaySecret = process.env.RELAY_WS_AUTH_SECRET?.trim() ?? "";
  const wsSecret = process.env.WS_AUTH_SECRET?.trim() ?? "";

  if (relaySecret && wsSecret) {
    return relaySecret === wsSecret ? "both_match" : "both_mismatch";
  }
  if (relaySecret) return "relay_only";
  if (wsSecret) return "ws_only";
  return "missing";
}

export async function GET() {
  const result: Record<string, unknown> = {
    ok: true,
    nodeEnv: process.env.NODE_ENV ?? null,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    relaySecretStatus: getRelaySecretStatus(),
    diagnostics: getDatabaseDiagnostics(),
  };

  try {
    validateServerConfig();
    result.securityConfig = "ok";
  } catch (err) {
    result.ok = false;
    result.securityConfig = "error";
    result.securityConfigError = (err as Error).message;
  }

  try {
    await ensureDatabaseConnection();
    await getDb().command({ ping: 1 });
    result.mongo = "ok";
  } catch (err) {
    result.ok = false;
    result.mongo = "error";
    result.mongoError = (err as Error).message;
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
