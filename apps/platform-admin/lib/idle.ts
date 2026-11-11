"use client";

// Sign-out after 15 minutes without use. The time of the last activity is kept next to the session, so it also
// works when the page was not running meanwhile (a phone in a pocket, a closed browser) and across tabs.
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const stampKey = (sessionKey: string) => `${sessionKey}:last-active`;

export function markActive(sessionKey: string): void {
  try {
    window.localStorage.setItem(stampKey(sessionKey), String(Date.now()));
  } catch {}
}

/** Milliseconds since the last activity, or null when none is recorded yet (a session made before this existed). */
export function idleFor(sessionKey: string): number | null {
  try {
    const at = Number(window.localStorage.getItem(stampKey(sessionKey)));
    return at > 0 ? Date.now() - at : null;
  } catch {
    return null;
  }
}

export const idleTooLong = (sessionKey: string): boolean => (idleFor(sessionKey) ?? 0) > IDLE_TIMEOUT_MS;

export function forgetActivity(sessionKey: string): void {
  try {
    window.localStorage.removeItem(stampKey(sessionKey));
  } catch {}
}
