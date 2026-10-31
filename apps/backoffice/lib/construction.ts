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
  orgUserId: string;
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

/** An API refusal with its details: warnings to confirm (409), blocks (400), or the BQ import preview. */
export class ConApiError extends ApiError {
  data: { message?: string; warnings?: string[]; blocks?: string[]; needsConfirm?: boolean; capExceeded?: boolean; [k: string]: unknown };
  constructor(message: string, status: number, data: ConApiError["data"]) {
    super(message, status);
    this.data = data;
  }
}

/** Like apiPost/apiPut, but a refusal keeps its warnings and blocks. A file body is sent raw with its name in X-File-Name. */
export async function conSend<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const s = getSession();
  if (!s) throw new ApiError("Not logged in", 401);
  const isFile = typeof File !== "undefined" && body instanceof File;
  const res = await fetch(`${s.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${s.accessToken}`,
      ...(isFile ? { "Content-Type": (body as File).type || "application/octet-stream", "X-File-Name": encodeURIComponent((body as File).name) } : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : isFile ? (body as File) : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as ConApiError["data"];
  if (!res.ok) throw new ConApiError(typeof json.message === "string" ? json.message : `Request failed (${res.status})`, res.status, json);
  return json as T;
}

/**
 * Runs a change the API may question: warnings (409) are shown for a yes/no and then sent again with confirm; above the NCA cap a
 * Director is asked for the override reason. Returns null when the person backs out.
 */
export async function withChecks<T>(send: (extra: { confirm?: boolean; overrideReason?: string }) => Promise<T>, canOverride: boolean): Promise<T | null> {
  const extra: { confirm?: boolean; overrideReason?: string } = {};
  for (let i = 0; i < 3; i++) {
    try {
      return await send(extra);
    } catch (e) {
      if (!(e instanceof ConApiError)) throw e;
      if (e.status === 409 && e.data.needsConfirm) {
        if (!window.confirm(`${e.message}\n\n- ${(e.data.warnings ?? []).join("\n- ")}\n\nGo ahead anyway?`)) return null;
        extra.confirm = true;
        continue;
      }
      if (e.status === 400 && e.data.capExceeded && canOverride) {
        const reason = window.prompt(`${e.message}\n\nAs Director you may go ahead. Give the reason (it is kept in the record):`);
        if (!reason?.trim()) return null;
        extra.overrideReason = reason.trim();
        continue;
      }
      throw e;
    }
  }
  return null;
}
