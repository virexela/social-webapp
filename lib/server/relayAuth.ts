import { createHmac } from "crypto";

type RelayScope = "chat" | "invite";

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createRelayJoinToken(room: string, scope: RelayScope, ttlSeconds = 120): string {
  const secret = process.env.RELAY_WS_AUTH_SECRET?.trim() ?? process.env.WS_AUTH_SECRET?.trim() ?? "";
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
