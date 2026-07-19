import { getDeviceConfig } from "./db";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Thrown instead of ApiError when there's plainly no network - lets callers distinguish "server rejected this" from "we're offline, queue it". */
export class OfflineError extends Error {
  constructor() {
    super("No network connection");
    this.name = "OfflineError";
  }
}

async function resolveBaseUrl(): Promise<string> {
  const config = await getDeviceConfig();
  if (!config) throw new Error("This terminal hasn't been set up yet");
  return config.apiBaseUrl.replace(/\/+$/, "");
}

export async function apiFetch<T>(path: string, options: (RequestInit & { token?: string }) = {}): Promise<T> {
  const { token, ...init } = options;
  const baseUrl = await resolveBaseUrl();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    // fetch() throws (not a rejected-with-status response) on total network
    // failure - exactly the case the offline queue exists for.
    throw new OfflineError();
  }

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

export const apiGet = <T>(path: string, token?: string) => apiFetch<T>(path, { method: "GET", token });
export const apiPost = <T>(path: string, body: unknown, token?: string) =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(body), token });
export const apiPatch = <T>(path: string, body: unknown, token?: string) =>
  apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body), token });
