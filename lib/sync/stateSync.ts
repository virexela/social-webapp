import { getCrypto } from "@/lib/crypto";
import { bytesToBase64Url } from "@/lib/protocol/base64url";
import { sha256 } from "@/lib/protocol/hash";
import { wrapBytesAesGcm } from "@/lib/storage/secureBlob";
import type { Contact } from "@/lib/state/store";
import { socialIdFromPublicBundle } from "./socialId";
import { getRelayWsUrl } from "@/lib/network/relayUrl";

interface SyncUpsertBody {
  social_id: string;
  account_blob_b64u?: string;
  contacts_blob_b64u?: string;
}

interface EncryptedBlobV1 {
  v: 1;
  iv_b64u: string;
  ciphertext_b64u: string;
}

function relaySyncBaseUrl(): string {
  const wsUrl = getRelayWsUrl();
  const u = new URL(wsUrl);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.origin;
}

async function deriveContactsKey(publicBundle: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.importKey) {
    throw new Error("WEBCRYPTO_UNAVAILABLE");
  }

  const domain = new TextEncoder().encode("social.contacts.sync.v1");
  const keyMaterial = new Uint8Array(domain.byteLength + publicBundle.byteLength);
  keyMaterial.set(domain, 0);
  keyMaterial.set(publicBundle, domain.byteLength);
  const digest = await sha256(keyMaterial);
  const digestCopy = digest.slice();

  return subtle.importKey(
    "raw",
    digestCopy.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptContactsBlob(
  contacts: Contact[],
  publicBundle: Uint8Array
): Promise<string> {
  const key = await deriveContactsKey(publicBundle);
  const plaintext = new TextEncoder().encode(JSON.stringify(contacts));
  const wrapped = await wrapBytesAesGcm(key, plaintext);
  const envelope: EncryptedBlobV1 = {
    v: 1,
    iv_b64u: bytesToBase64Url(wrapped.iv),
    ciphertext_b64u: bytesToBase64Url(wrapped.ciphertext),
  };
  return JSON.stringify(envelope);
}

async function upsertSync(body: SyncUpsertBody): Promise<void> {
  const endpoint = `${relaySyncBaseUrl()}/sync/upsert`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Sync upsert failed (${resp.status})`);
  }
}

export async function syncEncryptedStateBestEffort(
  contacts: Contact[]
): Promise<void> {
  const cryptoBridge = getCrypto();
  const [identityBlob, publicBundle] = await Promise.all([
    cryptoBridge.export_identity_blob(),
    cryptoBridge.export_public_bundle(),
  ]);

  const socialId = await socialIdFromPublicBundle(publicBundle);
  let contactsBlob: string | undefined;
  try {
    contactsBlob = await encryptContactsBlob(contacts, publicBundle);
  } catch {
    // On browsers without WebCrypto subtle APIs (some mobile HTTP contexts),
    // still sync the opaque account blob; skip contacts blob encryption.
  }

  const body: SyncUpsertBody = {
    social_id: socialId,
    account_blob_b64u: bytesToBase64Url(identityBlob),
    ...(contactsBlob ? { contacts_blob_b64u: contactsBlob } : {}),
  };

  try {
    await upsertSync(body);
  } catch {
    // best-effort sync; local state remains source of truth.
  }
}
