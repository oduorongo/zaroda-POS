"use client";

import { useEffect, useRef } from "react";

// A USB or Bluetooth scanner gun types like a very fast keyboard: the digits, then Enter. This listens for that burst
// anywhere on the page, when the person is NOT typing in a box (a box with a scanner's digits in it is handled by that
// box's own Enter key). A human typing is far slower than the gap below, so a slow key press starts a fresh burst.

const MAX_GAP_MS = 60;
const MIN_LENGTH = 4;

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

/** Calls onScan(code) when a scanner gun sends a code while nothing is being typed into. */
export function useScanner(onScan: (code: string) => void, enabled = true) {
  const callback = useRef(onScan);
  callback.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const now = Date.now();
      if (now - last > MAX_GAP_MS) buffer = "";
      last = now;
      if (e.key === "Enter") {
        const code = buffer;
        buffer = "";
        if (code.length >= MIN_LENGTH) {
          e.preventDefault();
          callback.current(code);
        }
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
