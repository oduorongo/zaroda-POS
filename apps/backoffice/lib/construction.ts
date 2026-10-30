"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "./api";
import { getSession, type Session } from "./auth";

export const CON_BRAND = { navy: "#1a2e5a", gold: "#d4af37", orange: "#f5820a" };

/** Roles that may sign in on the construction site (site supervisors are SUPERVISOR in core; cashiers belong at the till). */
export const CON_LOGIN_ROLES = ["OWNER", "MANAGER", "AUDITOR", "SUPERVISOR"];

export const kes = (n: number | null | undefined) => (n === null || n === undefined ? "Unlimited" : `KES ${Number(n).toLocaleString("en-KE")}`);

export type ConStatus = "TRIAL" | "ACTIVE" | "GRACE" | "SUSPENDED" | "CANCELLED";
export interface ConMe {
  isOwner: boolean;
  companyRoles: string[];
  projectRoles: { projectId: string; role: string }[];
  plan: { code: string; name: string; features: string[] };
  status: ConStatus;
}

export const isDirector = (me: ConMe | null) => !!me && (me.isOwner || me.companyRoles.includes("CON_DIRECTOR"));
export const hasConRole = (me: ConMe | null, ...roles: string[]) => isDirector(me) || (!!me && roles.some((r) => me.companyRoles.includes(r)));

/** The signed-in construction session, or a redirect: no session -> /login, a non-construction business -> its own back office. */
export function useConSession(): Session | null {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const s = getSession();
    if (!s) return router.replace("/login");
    if (s.industryType !== "CONSTRUCTION") return router.replace("/dashboard");
    setSession(s);
  }, [router]);
  return session;
}

/** A 402 from the API means "not on your plan" or "plan lapsed": show the upgrade card instead of an error. */
export const isUpgrade = (e: unknown) => e instanceof ApiError && e.status === 402;
export const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

async function raw(path: string, init: RequestInit): Promise<Response> {
  const s = getSession();
  if (!s) throw new ApiError("Not logged in", 401);
  const res = await fetch(`${s.apiBaseUrl.replace(/\/+$/, "")}${path}`, { ...init, headers: { Authorization: `Bearer ${s.accessToken}`, ...init.headers } });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { message?: unknown };
    throw new ApiError(typeof json.message === "string" ? json.message : `Request failed (${res.status})`, res.status);
  }
  return res;
}

/** Uploads a document's file as the raw body, with its name in X-File-Name. */
export async function conUpload<T>(path: string, file: File): Promise<T> {
  const res = await raw(path, { method: "POST", headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) }, body: file });
  return (await res.json()) as T;
}

/** Private files come through the API with the sign-in token, never from a public address. */
export async function conOpenFile(path: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const blob = await (await raw(path, { method: "GET" })).blob();
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
