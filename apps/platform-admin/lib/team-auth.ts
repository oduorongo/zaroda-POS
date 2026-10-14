"use client";

/**
 * The marketing teams' own session - a different localStorage key from the platform admin's, because it is a
 * different identity with different powers (a team leader or member, never an admin). The two can be signed
 * in at once in one browser without touching each other.
 */
export interface TeamSession {
  apiBaseUrl: string;
  accessToken: string;
}

const KEY = "zaroda-sales-team-session";

export function getTeamSession(): TeamSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TeamSession;
  } catch {
    return null;
  }
}

export function setTeamSession(session: TeamSession): void {
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearTeamSession(): void {
  window.localStorage.removeItem(KEY);
}
