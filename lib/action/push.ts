import { fetchWithAutoSession } from "@/lib/action/authFetch";

interface PushSubscriptionJson {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer.slice(
    outputArray.byteOffset,
    outputArray.byteOffset + outputArray.byteLength
  ) as ArrayBuffer;
}

export async function registerPushSubscription(socialId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { success: false, error: "Push notifications are not supported" };
    }
    if (!window.isSecureContext) {
      return {
        success: false,
        error: "Notifications require a secure context (HTTPS or localhost).",
      };
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    if (!publicKey) {
      return { success: false, error: "Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY" };
    }

    if (Notification.permission === "denied") {
      return {
        success: false,
        error:
          "Notification permission is blocked in your browser settings for this site. Enable it manually and retry.",
      };
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        success: false,
        error:
          permission === "denied"
            ? "Notification permission denied/blocked. Please allow notifications for this site in browser settings."
            : "Notification permission was dismissed. Please try again and click Allow.",
      };
    }

    const existing = await registration.pushManager.getSubscription();
    const sub =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(publicKey),
      }));

    const json = sub.toJSON() as PushSubscriptionJson;
    const response = await fetchWithAutoSession("/api/push/subscribe", {
      method: "POST",
      socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        socialId,
        endpoint: json.endpoint,
        keys: json.keys,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export async function unregisterPushSubscription(socialId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }
    }

    const response = await fetchWithAutoSession("/api/push/unsubscribe", {
      method: "POST",
      socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialId }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export async function notifyRoomMessage(roomId: string, senderSocialId: string): Promise<void> {
  try {
    await fetchWithAutoSession("/api/push/notify", {
      method: "POST",
      socialId: senderSocialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, senderSocialId }),
    });
  } catch {
    // best effort
  }
}

export async function getPushSubscriptionStatus(): Promise<{ success: boolean; subscribed: boolean; error?: string }> {
  try {
    if (!("serviceWorker" in navigator)) {
      return { success: false, subscribed: false, error: "Service workers are not supported" };
    }
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await registration?.pushManager.getSubscription();
    return { success: true, subscribed: Boolean(sub) };
  } catch (err) {
    return { success: false, subscribed: false, error: (err as Error).message || String(err) };
  }
}

export async function sendTestNotification(
  socialId: string
): Promise<{
  success: boolean;
  sent?: number;
  results?: Array<{ endpoint: string; ok: boolean; status?: number; error?: string }>;
  error?: string;
}> {
  try {
    const response = await fetchWithAutoSession("/api/push/test", {
      method: "POST",
      socialId,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialId }),
    });
    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }
    const data = await response.json();
    return {
      success: Boolean(data?.success),
      sent: Number(data?.sent ?? 0),
      results: Array.isArray(data?.results) ? data.results : [],
      error: data?.error,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}
