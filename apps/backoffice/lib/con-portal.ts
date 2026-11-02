import { ApiError } from "./api";

// The external portal (clients, consultants, subcontractors). Its own token, kept apart from the staff session.
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const KEY = "zaroda_con_portal";

export interface PortalAccount { token: string; organization: string; name: string; role: string }

export const PORTAL_ROLE: Record<string, string> = {
  CON_CLIENT: "Client",
  CON_CONSULTANT_QS: "Client's QS",
  CON_CONSULTANT_ARCH: "Client's architect",
  CON_CONSULTANT_ENG: "Client's engineer",
  CON_SUBCONTRACTOR: "Subcontractor",
};

export function portalAccount(): PortalAccount | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PortalAccount) : null;
  } catch {
    return null;
  }
}

export function setPortalAccount(a: PortalAccount | null) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    /* private window */
  }
}

async function call<T>(method: string, path: string, body?: unknown, token = portalAccount()?.token): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    if (res.status === 401 && token) setPortalAccount(null);
    throw new ApiError(Array.isArray(json.message) ? json.message.join(", ") : (json.message ?? `Request failed (${res.status})`), res.status);
  }
  return json as T;
}

export const portalGet = <T>(path: string) => call<T>("GET", `/construction-portal${path}`);
export const portalPost = <T>(path: string, body: unknown = {}) => call<T>("POST", `/construction-portal${path}`, body);

/** A photo is private: fetched with the token and shown from a local object URL. */
export async function portalPhotoUrl(path: string): Promise<string> {
  const res = await fetch(`${apiBaseUrl}/construction-portal${path}`, { headers: { Authorization: `Bearer ${portalAccount()?.token ?? ""}` } });
  if (!res.ok) throw new ApiError("Could not load the photo", res.status);
  return URL.createObjectURL(await res.blob());
}
