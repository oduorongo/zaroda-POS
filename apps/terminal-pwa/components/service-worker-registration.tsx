"use client";

import { useEffect } from "react";

/** Registers the hand-written service worker (public/sw.js) - see that file for what it actually caches. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed:", error);
      });
    }
  }, []);

  return null;
}
