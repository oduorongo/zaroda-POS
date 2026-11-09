"use client";

import { useEffect, useState } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Registers the Team app's service worker and offers "Install the Team app" (Android/desktop) or the iPhone steps. */
export function TeamInstall({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/team-sw.js", { scope: "/team" }).catch(() => {});
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  async function install() {
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setPrompt(null);
    } else {
      setShowIos((v) => !v);
    }
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-2 rounded-lg border border-border bg-surface p-4"}>
      <div className="flex flex-wrap items-center gap-3">
        <img src="/team-icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Get the ZARODA Team app</p>
          <p className="text-secondary-500">Its own icon on your phone, opens straight to your team.</p>
        </div>
        <button type="button" onClick={() => void install()} className="rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: "#f5820a" }}>
          Install
        </button>
      </div>
      {showIos && (
        <p className="text-sm text-secondary-600">
          On iPhone: tap the <b>Share</b> button (square with an arrow) at the bottom of Safari, then <b>Add to Home Screen</b>, then <b>Add</b>.
        </p>
      )}
    </div>
  );
}
