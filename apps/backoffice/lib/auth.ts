"use client";

/**
 * Always-online admin console - no Dexie/offline store needed (unlike
 * the terminal PWA). The session is just the JWT plus enough of its
 * payload to gate the UI, kept in localStorage so a page refresh doesn't
 * force a re-login.
 */
export interface Session {
  apiBaseUrl: string;
  accessToken: string;
  role: string;
  email: string;
  /** Fetched from GET /organizations/me at login - gates which vertical nav links/screens show (see components/nav.tsx). */
  industryType: string;
}

const KEY = "zaroda-backoffice-session";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(KEY);
}

/** Decodes the JWT payload without verifying it - display/gating only, never a trust boundary (the server re-checks every request). */
export function decodeRole(accessToken: string): string | null {
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1]));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
