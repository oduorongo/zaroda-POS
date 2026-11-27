"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "zaroda-till-install-dismissed";

/**
 * A small bar offering to install the till on the tablet, phone or computer. Chrome and Edge (Android, Windows, Mac) give an install event;
 * iPhones do not, so they get the "Share, then Add to Home Screen" hint. Hidden once installed, when already open as the app, after
 * "Not now".
 */
export default function InstallPrompt() {
  const path = usePathname() ?? "/";
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      /* private window: just show it */
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) return;
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      setIos(true);
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

  // Not over a sale in progress: only on the sign-in and cashier screens.
  if (hidden || (!event && !ios) || !(path === "/" || path.startsWith("/login") || path.startsWith("/setup"))) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div className="fixed inset-x-3 bottom-14 z-[60] mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border-2 bg-white px-4 py-3 text-sm shadow-lg print:hidden" style={{ borderColor: "#d4af37" }}>
      <span className="flex items-center gap-3 text-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="h-9 w-9 rounded-lg" />
        <span>{event ? `Install the ZARODA till on this device: it opens like an app, straight from your home screen.` : `Install the ZARODA till: tap Share, then "Add to Home Screen".`}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {event && (
          <button
            type="button"
            onClick={async () => {
              await event.prompt();
              await event.userChoice.catch(() => null);
              setEvent(null);
              setHidden(true);
            }}
            className="rounded-md px-3 py-1.5 font-semibold text-white"
            style={{ background: "#f5820a" }}
          >
            Install
          </button>
        )}
        <button type="button" onClick={dismiss} className="text-xs text-slate-500 hover:text-slate-900">
          Not now
        </button>
      </span>
    </div>
  );
}
