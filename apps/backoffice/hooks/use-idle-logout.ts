"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearSession, SESSION_KEY } from "../lib/auth";
import { IDLE_TIMEOUT_MS, idleFor, markActive } from "../lib/idle";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"] as const;

/**
 * Signs out after 15 minutes without use. Call once from a component on every signed-in page (e.g. Nav).
 * Defaults to the back-office session; the team app passes its own.
 */
export function useIdleLogout(opts: { sessionKey?: string; clear?: () => void; loginPath?: string } = {}) {
  const router = useRouter();
  const sessionKey = opts.sessionKey ?? SESSION_KEY;
  const clear = opts.clear ?? clearSession;
  const loginPath = opts.loginPath ?? "/login";

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastMark = 0;

    function logout() {
      clear();
      router.replace(loginPath);
    }

    // Activity in another tab counts too, so only sign out once the shared stamp is really 15 minutes old.
    function check() {
      if (timer) clearTimeout(timer);
      const idle = idleFor(sessionKey);
      if (idle === null) markActive(sessionKey);
      else if (idle > IDLE_TIMEOUT_MS) return logout();
      timer = setTimeout(check, IDLE_TIMEOUT_MS - (idle ?? 0) + 1000);
    }

    function onActivity() {
      if (Date.now() - lastMark < 15_000) return;
      lastMark = Date.now();
      const idle = idleFor(sessionKey);
      if (idle !== null && idle > IDLE_TIMEOUT_MS) return logout();
      markActive(sessionKey);
      check();
    }

    function onReturn() {
      if (document.visibilityState === "visible") check();
    }

    check();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", check);
    return () => {
      if (timer) clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, sessionKey, loginPath]);
}
