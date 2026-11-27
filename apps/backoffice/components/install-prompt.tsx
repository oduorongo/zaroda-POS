"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "zaroda-app-install-dismissed";

/** Which ZARODA app this address is, for the wording. */
function appName(host: string, path: string) {
  const is = (d?: string) => !!d && host === d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (is(process.env.NEXT_PUBLIC_SHAMBA_DOMAIN) || path.startsWith("/shamba")) return "ZARODA Shamba";
  if (is(process.env.NEXT_PUBLIC_CONSTRUCTION_DOMAIN) || path.startsWith("/construction")) return "ZARODA Build";
  if (is(process.env.NEXT_PUBLIC_RENTALS_DOMAIN) || path.startsWith("/rentals")) return "ZARODA Rentals";
  return "the ZARODA back office";
}

/**
 * A small bar offering to install the app on the phone or computer. Chrome and Edge (Android, Windows, Mac) give an install event;
 * iPhones do not, so they get the "Share, then Add to Home Screen" hint. Hidden once installed, when already open as the app, after
 * "Not now", and on the team pages (they have their own).
 */
export default function InstallPrompt() {
  const path = usePathname() ?? "/";
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [name, setName] = useState("the ZARODA back office");

  useEffect(() => {
    setName(appName(window.location.host, window.location.pathname));
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

  if (hidden || (!event && !ios) || path.startsWith("/team") || path.includes("/print") || path.includes("receipt")) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div className="fixed inset-x-3 bottom-14 z-[60] mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border-2 bg-surface px-4 py-3 text-sm shadow-lg print:hidden" style={{ borderColor: "#d4af37" }}>
      <span className="flex items-center gap-3 text-foreground">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/app-icon-192.png" alt="" className="h-9 w-9 rounded-lg" />
        <span>{event ? `Install ${name} on this device: it opens like an app, straight from your home screen.` : `Install ${name}: tap Share, then "Add to Home Screen".`}</span>
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
        <button type="button" onClick={dismiss} className="text-xs text-secondary-500 hover:text-foreground">
          Not now
        </button>
      </span>
    </div>
  );
}
