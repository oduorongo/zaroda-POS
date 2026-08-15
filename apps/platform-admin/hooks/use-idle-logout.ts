"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { clearSession } from "../lib/auth";

// A platform admin session can see every tenant - auto-logout on
// inactivity limits how long an unattended, unlocked machine stays a live
// cross-tenant credential. 15 minutes matches typical admin-console
// practice for sensitive back offices.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"] as const;

/** Call once from a component mounted on every authenticated page (e.g. Nav). */
export function useIdleLogout() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function logout() {
      clearSession();
      router.replace("/login");
    }

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, IDLE_TIMEOUT_MS);
    }

    resetTimer();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [router]);
}
