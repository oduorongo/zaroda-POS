"use client";

import { forgetActivity, idleTooLong, markActive } from "./idle";

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
  /** The shop's name, shown in the top ribbon; filled in by the nav the first time it is missing. */
  orgName?: string;
}

const KEY = "zaroda-backoffice-session";
export const SESSION_KEY = KEY;

/**
 * Everyone signs in on the one sign-in page and gets the menu for their role (lib/menu.ts). Supervisors and cashiers get a
 * small menu, and components/route-guard.tsx keeps them on it. A UI convenience only - the API's @Roles() guards are the
 * real authorization boundary.
 */
export const BACKOFFICE_ROLES = ["OWNER", "MANAGER", "AUDITOR", "SUPERVISOR", "CASHIER"] as const;

export function isBackofficeRole(role: string): boolean {
  return (BACKOFFICE_ROLES as readonly string[]).includes(role);
}

/** A landlord's on-site helper: signs in here but only ever sees the Rentals screen (see the API's @Roles on /rental). */
export const isCaretaker = (role: string): boolean => role === "CARETAKER";

/** Who may sign in for each kind of business (construction and farms keep their own role lists). */
export function canSignIn(role: string, industryType: string): boolean {
  if (industryType === "CONSTRUCTION" || industryType === "FARM") return ["OWNER", "MANAGER", "AUDITOR", "SUPERVISOR"].includes(role);
  if (industryType === "RENTAL") return ["OWNER", "MANAGER", "AUDITOR", "CARETAKER"].includes(role);
  return isBackofficeRole(role);
}

/** Where a freshly signed-in person lands. */
export const homePath = (role: string, industryType?: string): string =>
  isCaretaker(role) || industryType === "RENTAL" ? "/rentals" : industryType === "CONSTRUCTION" ? "/construction" : industryType === "FARM" ? "/shamba" : "/dashboard";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  if (idleTooLong(KEY)) {
    clearSession();
    return null;
  }
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(session));
  markActive(KEY);
}

export function clearSession(): void {
  window.localStorage.removeItem(KEY);
  forgetActivity(KEY);
}

/** The signed-in staff member's id from the token (display only - the server re-checks every request). */
export function decodeOrgUserId(accessToken: string): string | null {
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1]));
    return typeof payload.orgUserId === "string" ? payload.orgUserId : null;
  } catch {
    return null;
  }
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
