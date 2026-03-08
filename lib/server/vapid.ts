import { lookup } from "dns/promises";
import webpush from "web-push";
import { validateServerConfig } from "@/lib/server/config";

export interface WebPushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface WebPushPayload {
  kind: "room_message" | "test";
  roomId?: string;
  unreadCount?: number;
  lastMessageId?: string;
  latestSenderAlias?: string;
  title?: string;
  body?: string;
  url?: string;
}

type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function getVapidConfig(): VapidConfig {
  validateServerConfig();
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    throw new Error("Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY");
  }
  return { publicKey, privateKey, subject };
}

function isPrivateIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")) return true;
  return false;
}

async function validatePushEndpointSafety(endpoint: string): Promise<void> {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") {
    throw new Error("Push endpoint must use HTTPS");
  }

  const allowlist = (process.env.PUSH_ENDPOINT_ALLOWLIST ?? "")
    .split(",")
    .map((v) => v.trim())
    .map((value) => {
      if (!value) return "";
      try {
        return new URL(value).hostname.toLowerCase();
      } catch {
        return value.replace(/^\.+/, "").replace(/\/.*$/, "").replace(/:\d+$/, "").toLowerCase();
      }
    })
    .filter(Boolean);
  if (allowlist.length > 0) {
    const host = url.hostname.toLowerCase();
    const allowed = allowlist.some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!allowed) {
      throw new Error("Push endpoint hostname is not in allowlist");
    }
  }

  const resolved = await lookup(url.hostname, { all: true });
  if (resolved.some((r) => isPrivateIp(r.address))) {
    throw new Error("Push endpoint resolves to private network address");
  }
}

export async function sendWebPush(
  subscription: WebPushSubscriptionInput,
  payload?: WebPushPayload
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    await validatePushEndpointSafety(subscription.endpoint);
    const cfg = getVapidConfig();
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    const response = await webpush.sendNotification(
      subscription,
      payload ? JSON.stringify(payload) : undefined,
      {
        TTL: 60,
        urgency: "normal",
      }
    );
    const status = Number(response.statusCode ?? 0);

    if (status < 200 || status >= 300) {
      return { ok: false, status, error: String(response.body ?? "") };
    }

    return { ok: true, status };
  } catch (err) {
    const status = typeof (err as { statusCode?: unknown })?.statusCode === "number"
      ? Number((err as { statusCode: number }).statusCode)
      : undefined;
    const body = typeof (err as { body?: unknown })?.body === "string"
      ? (err as { body: string }).body
      : undefined;
    return { ok: false, status, error: body || (err as Error).message || String(err) };
  }
}
