import { getSession } from "./auth";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = getSession();
  if (!session) throw new ApiError("Not logged in", 401);

  const response = await fetch(`${session.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...options.headers,
    },
  });

  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "message" in json && typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path, { method: "GET" });
export const apiPost = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
export const apiPatch = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });

/** Login doesn't have a session yet - takes the API base URL directly instead of reading it from getSession(). */
export async function login(apiBaseUrl: string, email: string, password: string): Promise<{ accessToken: string }> {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "message" in json && typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Login failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as { accessToken: string };
}

/**
 * Same "no session yet" situation as login() above - called right after
 * login() succeeds but before setSession() runs, to learn the org's
 * industryType for gating vertical nav (components/nav.tsx) without a
 * second round trip once the session exists.
 */
export async function getOrganization(apiBaseUrl: string, accessToken: string): Promise<{ industryType: string }> {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/organizations/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "message" in json && typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as { industryType: string };
}
