import { createPrivateKey, createSign } from "crypto";

type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function base64UrlEncode(input: Buffer | string): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function derToJose(der: Buffer, size = 32): Buffer {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("Invalid DER signature");
  const seqLen = der[offset++];
  if (seqLen + 2 !== der.length) throw new Error("Invalid DER length");
  if (der[offset++] !== 0x02) throw new Error("Invalid DER integer for r");
  const rLen = der[offset++];
  let r = der.slice(offset, offset + rLen);
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error("Invalid DER integer for s");
  const sLen = der[offset++];
  let s = der.slice(offset, offset + sLen);

  while (r.length > size && r[0] === 0) r = r.slice(1);
  while (s.length > size && s[0] === 0) s = s.slice(1);
  if (r.length > size || s.length > size) throw new Error("Invalid DER component size");

  const out = Buffer.alloc(size * 2);
  r.copy(out, size - r.length);
  s.copy(out, size * 2 - s.length);
  return out;
}

function getVapidConfig(): VapidConfig {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    throw new Error("Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY");
  }
  return { publicKey, privateKey, subject };
}

function createVapidJwt(audience: string, cfg: VapidConfig): string {
  const pub = base64UrlDecode(cfg.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("Invalid VAPID public key format");
  }
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);

  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: cfg.privateKey,
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
  } as const;

  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = base64UrlEncode(JSON.stringify({ aud: audience, exp, sub: cfg.subject }));
  const input = `${header}.${payload}`;

  const signer = createSign("SHA256");
  signer.update(input);
  signer.end();
  const derSig = signer.sign(privateKey);
  const joseSig = derToJose(derSig);
  return `${input}.${base64UrlEncode(joseSig)}`;
}

export async function sendWebPush(endpoint: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const cfg = getVapidConfig();
    const aud = new URL(endpoint).origin;
    const jwt = createVapidJwt(aud, cfg);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        TTL: "60",
        Urgency: "normal",
        Authorization: `vapid t=${jwt}, k=${cfg.publicKey}`,
      },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: await response.text() };
    }

    return { ok: true, status: response.status };
  } catch (err) {
    return { ok: false, error: (err as Error).message || String(err) };
  }
}
