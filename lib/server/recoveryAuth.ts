import { createHash, createHmac, timingSafeEqual } from "crypto";

export type BackendKeyEnvelope = {
  v: 1;
  alg: "aes-256-gcm";
  ivHex: string;
  ciphertextHex: string;
  tagHex: string;
};

function isHexOfLength(value: string, length: number): boolean {
  return value.length === length && /^[0-9a-f]+$/i.test(value);
}

export function isValidBackendKeyEnvelope(envelope: BackendKeyEnvelope | undefined): boolean {
  if (!envelope) return false;
  if (envelope.v !== 1 || envelope.alg !== "aes-256-gcm") return false;

  return (
    isHexOfLength(envelope.ivHex, 24) &&
    envelope.ciphertextHex.length > 0 && envelope.ciphertextHex.length % 2 === 0 && /^[0-9a-f]+$/i.test(envelope.ciphertextHex) &&
    isHexOfLength(envelope.tagHex, 32)
  );
}

export function isValidRecoveryAuthHash(hash: string | undefined): boolean {
  return !!hash && /^[0-9a-f]{64}$/i.test(hash);
}

export function recoveryAuthMatches(expectedHash: string, providedHash: string): boolean {
  if (!isValidRecoveryAuthHash(expectedHash) || !isValidRecoveryAuthHash(providedHash)) {
    return false;
  }

  const expected = Buffer.from(expectedHash, "hex");
  const provided = Buffer.from(providedHash, "hex");
  if (expected.length !== provided.length) return false;

  return timingSafeEqual(expected, provided);
}

export function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function verifyChallengeSignature(
  recoveryAuthHash: string,
  action: "clear-data" | "delete-user",
  socialId: string,
  nonce: string,
  signatureHex: string
): boolean {
  if (!isValidRecoveryAuthHash(recoveryAuthHash)) return false;
  if (!/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length % 2 !== 0) return false;

  const payload = `${action}:${socialId}:${nonce}`;
  const expected = createHmac("sha256", Buffer.from(recoveryAuthHash, "hex"))
    .update(payload)
    .digest();
  const provided = Buffer.from(signatureHex, "hex");
  if (expected.length !== provided.length) return false;

  return timingSafeEqual(expected, provided);
}
