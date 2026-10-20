"use client";

import { useCallback, useEffect, useRef, useState, type ElementType } from "react";
import { audioUnlocked, ring, unlockAudio } from "../lib/alert-sound";
import { cn } from "../lib/cn";

export interface AlertItem {
  /** Stays the same for as long as the thing is waiting, so we ring once per NEW item and not on every refresh. */
  key: string;
  title: string;
  body?: string;
  /** Where to go to deal with it. */
  href?: string;
}

export interface ActivityAlertsProps {
  /** Everything that is waiting right now. Called every few seconds; a failure (offline) is simply skipped. */
  fetchItems: () => Promise<AlertItem[]>;
  /** Keeps what has already been announced, and the sound setting, apart for each app and person. */
  storageKey: string;
  intervalMs?: number;
  /** Pass the framework's Link so tapping an alert changes page without a reload. */
  LinkComponent?: ElementType;
}

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private window: alerts still work, they may just repeat after a reload */
  }
};

const POPUP_MS = 20_000;
const MAX_POPUPS = 4;

/**
 * "Something needs you": a pop-up and a ring when a new item turns up, plus a bell that lists everything still waiting.
 * It checks every few seconds while the page is open. (A phone that is asleep or a closed browser cannot be rung by a web
 * page - that needs a text message, which the apps also send where they can.)
 */
export function ActivityAlerts({ fetchItems, storageKey, intervalMs = 20_000, LinkComponent }: ActivityAlertsProps) {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [popups, setPopups] = useState<(AlertItem & { at: number })[]>([]);
  const [open, setOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const soundRef = useRef(true);
  const fetchRef = useRef(fetchItems);
  fetchRef.current = fetchItems;
  const baseTitle = useRef("");

  // Remember what was already announced, and the sound switch.
  useEffect(() => {
    try {
      seen.current = new Set(JSON.parse(read(`${storageKey}:seen`) ?? "[]") as string[]);
    } catch {
      seen.current = new Set();
    }
    const saved = read(`${storageKey}:sound`) !== "off";
    soundRef.current = saved;
    setSoundOn(saved);
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
  }, [storageKey]);

  // Sound is only allowed after a tap or key press, so the first one anywhere on the page switches it on.
  useEffect(() => {
    const unlock = () => {
      if (unlockAudio()) setUnlocked(true);
    };
    setUnlocked(audioUnlocked());
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchend", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchend", unlock);
    };
  }, []);

  const check = useCallback(async () => {
    let current: AlertItem[];
    try {
      current = await fetchRef.current();
    } catch {
      return; // offline or the server is busy: try again at the next tick
    }
    setItems(current);
    const fresh = current.filter((item) => !seen.current.has(item.key));
    // Only keep what is still waiting, so the list cannot grow for ever.
    seen.current = new Set(current.map((item) => item.key));
    write(`${storageKey}:seen`, JSON.stringify(Array.from(seen.current)));
    if (fresh.length === 0) return;
    const now = Date.now();
    setPopups((existing) => [...fresh.map((item) => ({ ...item, at: now })), ...existing].slice(0, MAX_POPUPS));
    if (soundRef.current) ring();
  }, [storageKey]);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), intervalMs);
    return () => clearInterval(timer);
  }, [check, intervalMs]);

  // Pop-ups fade away by themselves; the bell keeps the list.
  useEffect(() => {
    if (popups.length === 0) return;
    const timer = setInterval(() => setPopups((existing) => existing.filter((p) => Date.now() - p.at < POPUP_MS)), 2000);
    return () => clearInterval(timer);
  }, [popups.length]);

  // "(3) Orders" in the browser tab, so it shows even when another tab is in front.
  useEffect(() => {
    const base = baseTitle.current || document.title.replace(/^\(\d+\)\s*/, "");
    document.title = items.length > 0 ? `(${items.length}) ${base}` : base;
  }, [items.length]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundRef.current = next;
    write(`${storageKey}:sound`, next ? "on" : "off");
    if (next && unlockAudio()) {
      setUnlocked(true);
      ring(); // a sample, so they know what it sounds like
    }
  };

  const Anchor = LinkComponent ?? "a";

  return (
    <>
      {popups.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-[200] flex flex-col items-center gap-2 px-3" role="status" aria-live="assertive">
          {popups.map((p) => (
            <div key={`${p.key}-${p.at}`} className="pointer-events-auto w-full max-w-sm rounded-lg border border-primary-500 bg-surface p-3 shadow-xl">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-lg" aria-hidden="true">
                  🔔
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{p.title}</p>
                  {p.body && <p className="text-sm text-secondary-600">{p.body}</p>}
                  {p.href && (
                    <Anchor href={p.href} className="mt-1 inline-block text-sm font-semibold text-primary-600 hover:underline" onClick={() => setPopups((e) => e.filter((x) => x.key !== p.key))}>
                      Open
                    </Anchor>
                  )}
                </div>
                <button type="button" onClick={() => setPopups((e) => e.filter((x) => x.key !== p.key))} aria-label="Dismiss" className="text-secondary-500 hover:text-foreground">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="fixed bottom-4 right-4 z-[190] flex flex-col items-end gap-2">
        {open && (
          <div className="w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold">{items.length === 0 ? "Nothing waiting" : `${items.length} waiting`}</p>
              <button type="button" onClick={toggleSound} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary-500/10">
                {soundOn ? "🔊 Sound on" : "🔇 Sound off"}
              </button>
            </div>
            {soundOn && !unlocked && <p className="mb-2 rounded-md bg-warning-50 p-2 text-xs text-warning-800">Tap anywhere on this page once to allow the ring.</p>}
            {items.length === 0 ? (
              <p className="text-sm text-secondary-500">New orders and requests will pop up here and ring.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {items.map((item) => (
                  <li key={item.key} className="rounded-md border border-border p-2 text-sm">
                    <p className="font-medium">{item.title}</p>
                    {item.body && <p className="text-xs text-secondary-600">{item.body}</p>}
                    {item.href && (
                      <Anchor href={item.href} className="text-xs font-semibold text-primary-600 hover:underline" onClick={() => setOpen(false)}>
                        Open
                      </Anchor>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={items.length > 0 ? `${items.length} waiting - open the list` : "Alerts"}
          className={cn(
            "relative flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-xl shadow-lg hover:bg-secondary-500/10",
            items.length > 0 && "border-primary-500",
          )}
        >
          <span aria-hidden="true">{soundOn ? "🔔" : "🔕"}</span>
          {items.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-error-600 px-1 text-xs font-bold text-white">{items.length > 9 ? "9+" : items.length}</span>
          )}
        </button>
      </div>
    </>
  );
}
