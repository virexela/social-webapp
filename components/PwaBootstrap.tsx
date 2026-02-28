"use client";

import { useEffect } from "react";

export function PwaBootstrap() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
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
