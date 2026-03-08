import { createHmac } from "crypto";

type RelayScope = "chat" | "invite";

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function resolveRelayAuthSecret(): string {
  const relaySecret = process.env.RELAY_WS_AUTH_SECRET?.trim() ?? "";
  const wsSecret = process.env.WS_AUTH_SECRET?.trim() ?? "";

  if (relaySecret && wsSecret && relaySecret !== wsSecret) {
    throw new Error("RELAY_WS_AUTH_SECRET and WS_AUTH_SECRET must match when both are set");
  }

  return relaySecret || wsSecret;
}

export function createRelayJoinToken(room: string, scope: RelayScope, ttlSeconds = 120): string {
  const secret = resolveRelayAuthSecret();
  if (!secret) {
    throw new Error("Missing RELAY_WS_AUTH_SECRET (or WS_AUTH_SECRET) for relay token signing");
  }

  const payloadB64 = base64UrlEncode(
    JSON.stringify({
      room,
      scope,
      exp: Math.floor(Date.now() / 1000) + Math.max(30, ttlSeconds),
    })
  );
  const sig = signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}
