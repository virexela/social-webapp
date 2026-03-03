const CACHE_VERSION = "v3";
const CACHE_NAME = `social-app-${CACHE_VERSION}`;
const PRECACHE_ASSETS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

let activeRoomId = null;
let notificationsEnabled = true;
const seenMessageIds = new Map();
const MAX_SEEN_MESSAGE_IDS = 200;

function rememberMessageId(messageId) {
  if (!messageId) return;
  seenMessageIds.set(messageId, Date.now());
  if (seenMessageIds.size <= MAX_SEEN_MESSAGE_IDS) return;
  const oldest = [...seenMessageIds.entries()].sort((a, b) => a[1] - b[1])[0];
  if (oldest) {
    seenMessageIds.delete(oldest[0]);
  }
}

function hasSeenMessageId(messageId) {
  return Boolean(messageId && seenMessageIds.has(messageId));
}

async function trackMetric(kind, count = 1) {
  try {
    await fetch(`/api/push/metrics?kind=${encodeURIComponent(kind)}&count=${encodeURIComponent(String(count))}`, {
      method: "GET",
      cache: "no-store",
    });
  } catch {
    // best effort
  }
}

async function getPendingNotifications() {
  const response = await fetch("/api/push/pending", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`pending_fetch_failed_${response.status}`);
  }
  const data = await response.json();
  if (!data?.success || !Array.isArray(data?.pending)) {
    return [];
  }
  return data.pending;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("social-app-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match("/")) ?? Response.error();
      })
    );
    return;
  }

  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (!(requestUrl.pathname.startsWith("/_next/") || requestUrl.pathname.startsWith("/icon-") || requestUrl.pathname.endsWith(".png") || requestUrl.pathname.endsWith(".svg") || requestUrl.pathname.endsWith(".webmanifest"))) {
    return;
  }

  // Stale-while-revalidate for static assets.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const networkPromise = fetch(event.request).then((response) => {
        if (response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const cloned = response.clone();
        void cache.put(event.request, cloned);
        return response;
      });

      if (cached) {
        void networkPromise.catch(() => undefined);
        return cached;
      }
      return networkPromise.catch(() => Response.error());
    })
  );
});

self.addEventListener("message", (event) => {
  const data = event.data ?? {};
  if (data.type !== "chat_runtime_state") return;

  if (typeof data.activeRoomId === "string") {
    activeRoomId = data.activeRoomId || null;
  } else if (data.activeRoomId === null) {
    activeRoomId = null;
  }

  if (typeof data.notificationsEnabled === "boolean") {
    notificationsEnabled = data.notificationsEnabled;
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      let pending = [];
      try {
        pending = await getPendingNotifications();
      } catch {
        void trackMetric("push_pending_fetch_failed");
      }

      clientList.forEach((client) => {
        client.postMessage({ type: "push_pending_summary", pending });
      });

      if (!notificationsEnabled) {
        void trackMetric("push_suppressed");
        return;
      }

      if (pending.length === 0) {
        return;
      }

      const latest = pending[0];
      const roomId = String(latest?.roomId ?? "");
      const unreadCount = Number(latest?.unreadCount ?? 0);
      const lastMessageId = String(latest?.lastMessageId ?? "");
      const latestSenderAlias = String(latest?.latestSenderAlias ?? "");
      if (!roomId || unreadCount <= 0) {
        return;
      }

      if (hasSeenMessageId(lastMessageId)) {
        void trackMetric("push_deduped");
        return;
      }
      rememberMessageId(lastMessageId);

      const hasVisibleWindow = clientList.some((client) => client.visibilityState === "visible");
      if (hasVisibleWindow && activeRoomId && activeRoomId === roomId) {
        void trackMetric("push_suppressed");
        return;
      }

      const title = "New messages";
      const summaryBody =
        unreadCount > 1
          ? `${unreadCount} new messages`
          : "You have a new encrypted message.";
      const options = {
        body: latestSenderAlias ? `${latestSenderAlias}: ${summaryBody}` : summaryBody,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: `room:${roomId}`,
        renotify: false,
        data: { url: `/chat?roomId=${encodeURIComponent(roomId)}`, roomId },
      };

      await self.registration.showNotification(title, options);
      void trackMetric("push_displayed");
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";
  void trackMetric("push_clicked");

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
