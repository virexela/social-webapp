self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open("social-app-v1")
      .then((cache) =>
        cache.addAll(["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"])
      )
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("social-app-") && key !== "social-app-v1").map((key) => caches.delete(key)))
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
        const cache = await caches.open("social-app-v1");
        return (await cache.match("/")) ?? Response.error();
      })
    );
    return;
  }

  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.status !== 200 || response.type !== "basic") {
            return response;
          }
          const cloned = response.clone();
          void caches.open("social-app-v1").then((cache) => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => Response.error());
    })
  );
});

self.addEventListener("push", (event) => {
  const title = "New message";
  const options = {
    body: "You have a new encrypted message.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: "/" },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        clientList.forEach((client) => {
          client.postMessage({ type: "push_received" });
        });
      }),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";

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
