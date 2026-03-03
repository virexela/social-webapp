let validated = false;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function assertBase64Url(name: string, value: string) {
  if (!/^[A-Za-z0-9\-_]+={0,2}$/.test(value)) {
    throw new Error(`Invalid ${name} format`);
  }
}

export function validateServerConfig(): void {
  if (validated) return;

  requireEnv("MONGODB_URI");

  const vapidPublic = requireEnv("VAPID_PUBLIC_KEY");
  const vapidPrivate = requireEnv("VAPID_PRIVATE_KEY");
  const vapidSubject = requireEnv("VAPID_SUBJECT");
  assertBase64Url("VAPID_PUBLIC_KEY", vapidPublic);
  assertBase64Url("VAPID_PRIVATE_KEY", vapidPrivate);

  if (!/^mailto:|^https:\/\//.test(vapidSubject)) {
    throw new Error("VAPID_SUBJECT must be a mailto: or https:// URL");
  }

  const redisUrl = process.env.RATE_LIMIT_REDIS_REST_URL?.trim();
  const redisToken = process.env.RATE_LIMIT_REDIS_REST_TOKEN?.trim();
  if ((redisUrl && !redisToken) || (!redisUrl && redisToken)) {
    throw new Error("RATE_LIMIT_REDIS_REST_URL and RATE_LIMIT_REDIS_REST_TOKEN must be set together");
  }

  const pushDataKey = process.env.PUSH_DATA_ENCRYPTION_KEY?.trim();
  if (pushDataKey) {
    const isHex = /^[0-9a-f]{64}$/i.test(pushDataKey);
    const asB64 = Buffer.from(pushDataKey, "base64");
    const isBase64_32 = asB64.length === 32;
    if (!isHex && !isBase64_32) {
      throw new Error("PUSH_DATA_ENCRYPTION_KEY must be 32-byte hex or base64");
    }
  }

  const privacyPepper = process.env.PRIVACY_ID_PEPPER?.trim();
  if (process.env.NODE_ENV === "production" && !privacyPepper) {
    throw new Error("PRIVACY_ID_PEPPER is required in production");
  }

  const sessionPepper = process.env.SESSION_HASH_PEPPER?.trim();
  if (process.env.NODE_ENV === "production" && !sessionPepper) {
    throw new Error("SESSION_HASH_PEPPER is required in production");
  }

  const relaySecret = (process.env.RELAY_WS_AUTH_SECRET ?? process.env.WS_AUTH_SECRET)?.trim();
  if (process.env.NODE_ENV === "production" && !relaySecret) {
    throw new Error("RELAY_WS_AUTH_SECRET (or WS_AUTH_SECRET) is required in production");
  }

  validated = true;
}
