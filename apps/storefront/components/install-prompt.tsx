"use client";

import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "zaroda-install-dismissed";

// A small bar offering to put the marketplace on the home screen. Android/desktop Chrome and Edge give us an
// install event; iPhones don't, so they get the two-step instruction instead. Hidden once installed or dismissed.
export default function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      /* private window: just show it */
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      setIosHint(true);
      setHidden(false);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || (!event && !iosHint)) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div className="mx-auto mb-3 flex max-w-6xl items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <span className="text-foreground">
        {event ? "Put Zaroda Marketplace on your home screen." : "To install: tap the Share button, then “Add to Home Screen”."}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {event && (
          <button
            type="button"
            onClick={async () => {
              await event.prompt();
              await event.userChoice.catch(() => null);
              setEvent(null);
              setHidden(true);
            }}
            className="rounded-md bg-primary-600 px-3 py-1.5 font-semibold text-white hover:bg-primary-700"
          >
            Install
          </button>
        )}
        <button type="button" onClick={dismiss} className="text-secondary-500 hover:text-foreground" aria-label="Dismiss">
          Not now
        </button>
      </span>
    </div>
  );
}
