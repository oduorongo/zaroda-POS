"use client";

/**
 * Namespaced under a completely different localStorage key from
 * apps/backoffice's "zaroda-backoffice-session" - even if someone somehow
 * opened both apps in the same browser profile, a platform-admin session
 * and a tenant session can never collide or be read by the other app's
 * code (different origin/port anyway, but this is a second, cheap layer
 * of "these are not the same kind of session" on top of that).
 */
export interface Session {
  apiBaseUrl: string;
  accessToken: string;
  email: string;
}

const KEY = "zaroda-platform-admin-session";

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
