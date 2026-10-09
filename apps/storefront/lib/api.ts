import type { Buyer, Order, Shop, ShopSummary } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Server components call the API directly; the browser calls it from the
// buyer's device - so this must be the API's PUBLIC address, and the API's
// CORS_ORIGIN must list this storefront's origin.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");

async function request<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
  } catch {
    throw new ApiError("Could not reach the shop right now - check your connection and try again.", 0);
  }
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof json === "object" && json && "message" in json ? (json as { message: unknown }).message : null;
    const message = Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" ? raw : `Something went wrong (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

// ── Public (server-rendered, cached briefly so stock stays reasonably fresh) ──

export const listShops = (q?: string) =>
  request<ShopSummary[]>(`/public/shops${q ? `?q=${encodeURIComponent(q)}` : ""}`, { next: { revalidate: 30 } } as RequestInit);

export const getShop = (slug: string) =>
  request<Shop>(`/public/shops/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } } as RequestInit);

// ── Buyer ────────────────────────────────────────────────────────────────

export const requestCode = (phone: string) =>
  request<{ sent: boolean; phone: string }>("/buyer-auth/request-code", { method: "POST", body: JSON.stringify({ phone }) });

export const verifyCode = (phone: string, code: string) =>
  request<{ accessToken: string; buyer: Buyer }>("/buyer-auth/verify", { method: "POST", body: JSON.stringify({ phone, code }) });

export const getMe = (token: string) => request<Buyer>("/buyer/me", { token });

export const updateMe = (token: string, name: string) =>
  request<Buyer>("/buyer/me", { method: "PATCH", token, body: JSON.stringify({ name }) });

export interface CreateOrderInput {
  shopSlug: string;
  lines: { variantId: string; quantity: number }[];
  fulfilmentType: "PICKUP" | "DELIVERY";
  deliveryAddress?: string;
  note?: string;
  buyerName?: string;
  paymentPhone?: string;
}

export const createOrder = (token: string, input: CreateOrderInput) =>
  request<Order>("/buyer/orders", { method: "POST", token, body: JSON.stringify(input) });

export const listOrders = (token: string) => request<Order[]>("/buyer/orders", { token });

export const getOrder = (token: string, id: string) => request<Order>(`/buyer/orders/${id}`, { token });

export const payOrder = (token: string, id: string, paymentPhone?: string) =>
  request<Order>(`/buyer/orders/${id}/pay`, { method: "POST", token, body: JSON.stringify(paymentPhone ? { paymentPhone } : {}) });

export const cancelOrder = (token: string, id: string) =>
  request<Order>(`/buyer/orders/${id}/cancel`, { method: "POST", token, body: "{}" });
