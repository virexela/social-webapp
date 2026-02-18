import { getCrypto } from "@/lib/crypto";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/protocol/base64url";
import { RelaySocket } from "@/lib/network/socket";
import { decodeEnvelope } from "@/lib/protocol/envelope";
import { sha256 } from "@/lib/protocol/hash";

export interface CloudBackupMeta {
  nicknamesByConnectionId?: Record<string, string>;
}

export interface UploadCloudBackupOptions {
  relayUrl: string;
  recoveryKey: Uint8Array;
  meta?: CloudBackupMeta;
}

export interface DownloadCloudBackupOptions {
  relayUrl: string;
  recoveryKey: Uint8Array;
  timeoutMs?: number;
}

export interface DownloadCloudBackupResult {
  backupBlob: Uint8Array;
  meta?: CloudBackupMeta;
}

interface RelayBackupEnvelopeV1 {
  v: 1;
  backupBlobB64u: string;
  meta?: CloudBackupMeta;
  uploadedAtMs: number;
}

const BACKUP_DOMAIN = new TextEncoder().encode("social.cloud_backup.mailbox.v1");
const MAX_BACKUP_MESSAGE_BYTES = 60 * 1024;

function normalizeRelayWsUrl(input: string): string {
  return input.endsWith("/ws") ? input : `${input}/ws`;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

async function deriveBackupMailboxId(recoveryKey: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(BACKUP_DOMAIN, recoveryKey));
}

function encodeBackupEnvelope(backupBlob: Uint8Array, meta?: CloudBackupMeta): Uint8Array {
  const payload: RelayBackupEnvelopeV1 = {
    v: 1,
    backupBlobB64u: bytesToBase64Url(backupBlob),
    meta,
    uploadedAtMs: Date.now(),
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

function tryParseBackupEnvelope(payload: Uint8Array): RelayBackupEnvelopeV1 | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as RelayBackupEnvelopeV1;
    if (parsed.v !== 1) return null;
    if (!parsed.backupBlobB64u || typeof parsed.backupBlobB64u !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function waitForAck(socket: RelaySocket, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      unsub();
      reject(new Error("Relay did not acknowledge backup upload"));
    }, timeoutMs);

    const unsub = socket.addFrameListener(() => {
      window.clearTimeout(timer);
      unsub();
      resolve();
    });
  });
}

async function fetchMailboxPayloads(
  socket: RelaySocket,
  mailboxId: Uint8Array,
  timeoutMs: number
): Promise<Uint8Array[]> {
  const payloads: Uint8Array[] = [];
  const unsub = socket.addFrameListener((frame) => {
    try {
      const env = decodeEnvelope(frame);
      if (env.opcode === 2 && env.payload.byteLength > 0) {
        payloads.push(env.payload);
      }
    } catch {
      // Ignore non-envelope/bincode responses.
    }
  });

  try {
    socket.fetchMessages(mailboxId);
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), timeoutMs);
    });
    return payloads;
  } finally {
    unsub();
  }
}

export async function uploadCloudBackup(options: UploadCloudBackupOptions): Promise<void> {
  const { relayUrl, recoveryKey, meta } = options;
  const socket = new RelaySocket(normalizeRelayWsUrl(relayUrl));

  if (recoveryKey.byteLength !== 32) {
    throw new Error("Recovery key must be 32 bytes");
  }

  const backupBlob = await getCrypto().export_backup(recoveryKey);
  const mailboxId = await deriveBackupMailboxId(recoveryKey);
  const relayPayload = encodeBackupEnvelope(backupBlob, meta);

  if (relayPayload.byteLength > MAX_BACKUP_MESSAGE_BYTES) {
    throw new Error("Backup blob is too large for relay storage");
  }

  try {
    await socket.connectAndWaitOpen(8000);
    socket.sendPutMessage(mailboxId, relayPayload);
    await waitForAck(socket, 5000);
  } finally {
    socket.close();
  }
}

export async function downloadCloudBackup(
  options: DownloadCloudBackupOptions
): Promise<DownloadCloudBackupResult> {
  const { relayUrl, recoveryKey } = options;
  const timeoutMs = options.timeoutMs ?? 2000;
  const socket = new RelaySocket(normalizeRelayWsUrl(relayUrl));

  if (recoveryKey.byteLength !== 32) {
    throw new Error("Recovery key must be 32 bytes");
  }

  try {
    await socket.connectAndWaitOpen(8000);
    const mailboxId = await deriveBackupMailboxId(recoveryKey);
    const payloads = await fetchMailboxPayloads(socket, mailboxId, timeoutMs);

    let latest: DownloadCloudBackupResult | null = null;
    for (const payload of payloads) {
      const parsed = tryParseBackupEnvelope(payload);
      if (!parsed) continue;

      latest = {
        backupBlob: base64UrlToBytes(parsed.backupBlobB64u),
        meta: parsed.meta,
      };
    }

    if (!latest) {
      throw new Error("No backup found for this recovery key");
    }

    return latest;
  } finally {
    socket.close();
  }
}
