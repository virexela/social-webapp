"use client";

import { useEffect } from "react";

export function PwaBootstrap() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter((key) => key.startsWith("social-app-")).map((key) => caches.delete(key)));
          }
        } catch {
          // ignore cleanup errors in development
        }
      })();
      return;
    }

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // best effort; push registration has its own error handling path.
      }
    };

    if (document.readyState === "complete") {
      void register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
