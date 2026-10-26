import { API_URL, ApiError } from "./api";

// A school's own account on the tender board: register, sign in, post and manage tender adverts. Its token only works on
// /tender-buyer.

async function call<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...rest.headers },
    });
  } catch {
    throw new ApiError("Could not reach Zaroda right now - check your connection and try again.", 0);
  }
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof json === "object" && json && "message" in json ? (json as { message: unknown }).message : null;
    const message = Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" ? raw : `Something went wrong (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

export interface TenderSchool {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string | null;
  county: string;
  status: "PENDING" | "APPROVED" | "SUSPENDED";
  statusNote: string | null;
}
export interface AdvertItem {
  description: string;
  quantity: number | null;
  unit: string | null;
}
export interface TenderAdvert {
  id: string;
  reference: string | null;
  title: string;
  description: string;
  county: string;
  items: AdvertItem[];
  documentsInfo: string | null;
  pdfUrl: string | null;
  pdfName: string | null;
  closingDate: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  status: "OPEN" | "CANCELLED" | "REMOVED";
  removedReason: string | null;
  closed: boolean;
  postedAt: string;
}
export interface SaveAdvert {
  reference?: string;
  title: string;
  description: string;
  county: string;
  items: { description: string; quantity?: number; unit?: string }[];
  documentsInfo?: string;
  closingDate: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
}
interface Session {
  accessToken: string;
  school: TenderSchool;
}

export const tenderRegister = (body: { name: string; contactName: string; phone: string; email?: string; county: string; pin: string }) =>
  call<Session>("/tender-buyer-auth/register", { method: "POST", body: JSON.stringify(body) });
export const tenderLogin = (phone: string, pin: string) => call<Session>("/tender-buyer-auth/login", { method: "POST", body: JSON.stringify({ phone, pin }) });
export const tenderMe = (token: string) => call<TenderSchool>("/tender-buyer/me", { token });
export const tenderAdverts = (token: string) => call<TenderAdvert[]>("/tender-buyer/adverts", { token });
export const tenderPost = (token: string, body: SaveAdvert) => call<TenderAdvert>("/tender-buyer/adverts", { method: "POST", token, body: JSON.stringify(body) });
export const tenderUpdate = (token: string, id: string, body: SaveAdvert) => call<TenderAdvert>(`/tender-buyer/adverts/${id}`, { method: "PUT", token, body: JSON.stringify(body) });
/** The school's own tender document: the file itself is the request body. */
export async function tenderUploadPdf(token: string, id: string, file: File): Promise<TenderAdvert> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/tender-buyer/adverts/${id}/pdf?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf", Authorization: `Bearer ${token}` },
      body: file,
    });
  } catch {
    throw new ApiError("Could not reach Zaroda right now - check your connection and try again.", 0);
  }
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof json === "object" && json && "message" in json ? (json as { message: unknown }).message : null;
    throw new ApiError(typeof raw === "string" ? raw : `Could not upload the PDF (${response.status})`, response.status);
  }
  return json as TenderAdvert;
}
export const tenderRemovePdf = (token: string, id: string) => call<TenderAdvert>(`/tender-buyer/adverts/${id}/pdf`, { method: "DELETE", token });
export const tenderCancel = (token: string, id: string) => call<TenderAdvert>(`/tender-buyer/adverts/${id}/cancel`, { method: "POST", token });
