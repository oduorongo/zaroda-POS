import type { Buyer, BuyerDelivery, Reservation, HotelDetail, HotelSummary, HouseDetail, HouseSummary, MyJob, RoomBooking, TableInfo, TableOrder, OpenJob, Order, OrderCheck, Rider, Shop, ShopSummary, VehicleType } from "./types";

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

export interface HouseFilters {
  area?: string;
  type?: string;
  minRent?: string;
  maxRent?: string;
  page?: number;
}

/** Adverts for empty rental units across all landlords ("Houses to let"). */
export function listHouses(filters: HouseFilters) {
  const query = new URLSearchParams();
  if (filters.area) query.set("area", filters.area);
  if (filters.type) query.set("type", filters.type);
  if (filters.minRent) query.set("minRent", filters.minRent);
  if (filters.maxRent) query.set("maxRent", filters.maxRent);
  if (filters.page) query.set("page", String(filters.page));
  const qs = query.toString();
  return request<{ houses: HouseSummary[]; hasMore: boolean }>(`/public/houses${qs ? `?${qs}` : ""}`, { next: { revalidate: 30 } } as RequestInit);
}

export const getHouse = (id: string) => request<HouseDetail>(`/public/houses/${encodeURIComponent(id)}`, { next: { revalidate: 30 } } as RequestInit);

// ── Diner at a table (no sign-in; the order is opened with a secret the diner's browser holds) ──

export const getTable = (slug: string, tableId: string) =>
  request<TableInfo>(`/public/shops/${encodeURIComponent(slug)}/tables/${encodeURIComponent(tableId)}`, { cache: "no-store" });

export interface CreateTableOrderInput {
  shopSlug: string;
  tableId: string;
  lines: { variantId: string; quantity: number; note?: string }[];
  phone: string;
  name?: string;
  note?: string;
  /** A tip for the staff in whole shillings, paid in the same M-Pesa prompt. */
  tipAmount?: number;
}

/** The order, plus the secret (guestToken) that opens its status page. */
export const createTableOrder = (input: CreateTableOrderInput) =>
  request<TableOrder & { guestToken: string }>("/public/table-orders", { method: "POST", body: JSON.stringify(input) });

export const getTableOrder = (id: string, token: string) =>
  request<TableOrder>(`/public/table-orders/${encodeURIComponent(id)}?k=${encodeURIComponent(token)}`, { cache: "no-store" });

export const retryTableOrder = (id: string, token: string, phone?: string) =>
  request<TableOrder>(`/public/table-orders/${encodeURIComponent(id)}/retry`, { method: "POST", body: JSON.stringify({ token, phone }) });

export const checkTableOrder = (id: string, token: string) =>
  request<TableOrder & { checkResult: "paid" | "not-paid-yet" | "unavailable" | "not-needed" }>(`/public/table-orders/${encodeURIComponent(id)}/check`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });

/** The menu exactly as the kitchen can make it right now - for a diner at a table, never a cached copy. */
export const getShopFresh = (slug: string) => request<Shop>(`/public/shops/${encodeURIComponent(slug)}`, { cache: "no-store" });

// ── Hotels (availability changes as guests book, so none of this is cached) ──

const stayQuery = (checkIn?: string, checkOut?: string) => (checkIn && checkOut ? `checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}` : "");

export function listHotels(filters: { area?: string; checkIn?: string; checkOut?: string }) {
  const parts = [filters.area ? `area=${encodeURIComponent(filters.area)}` : "", stayQuery(filters.checkIn, filters.checkOut)].filter(Boolean);
  return request<HotelSummary[]>(`/public/hotels${parts.length ? `?${parts.join("&")}` : ""}`, { cache: "no-store" });
}

export const getHotel = (slug: string, checkIn?: string, checkOut?: string) =>
  request<HotelDetail>(`/public/hotels/${encodeURIComponent(slug)}${checkIn && checkOut ? `?${stayQuery(checkIn, checkOut)}` : ""}`, { cache: "no-store" });

export interface CreateBookingInput {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: number;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
}

/** The booking, plus the secret (guestToken) that opens its page. */
export const createBooking = (slug: string, input: CreateBookingInput) =>
  request<RoomBooking & { guestToken: string }>(`/public/hotels/${encodeURIComponent(slug)}/bookings`, { method: "POST", body: JSON.stringify(input) });

export const getBooking = (id: string, token: string) =>
  request<RoomBooking>(`/public/room-bookings/${encodeURIComponent(id)}?k=${encodeURIComponent(token)}`, { cache: "no-store" });

export const retryBooking = (id: string, token: string, phone?: string) =>
  request<RoomBooking>(`/public/room-bookings/${encodeURIComponent(id)}/retry`, { method: "POST", body: JSON.stringify({ token, phone }) });

export const checkBooking = (id: string, token: string) =>
  request<RoomBooking & { checkResult: "paid" | "not-paid-yet" | "unavailable" | "not-needed" }>(`/public/room-bookings/${encodeURIComponent(id)}/check`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });

// ── Table reservations (a guest asks for a table; the restaurant confirms or declines) ──

export const getReservationInfo = (slug: string) =>
  request<{ enabled: boolean; restaurant: string }>(`/public/shops/${encodeURIComponent(slug)}/reservations/info`, { cache: "no-store" });

export interface CreateReservationInput {
  name: string;
  phone: string;
  partySize: number;
  date: string;
  time: string;
  notes?: string;
}

/** The request, plus the secret (guestToken) that opens its page. */
export const createReservation = (slug: string, input: CreateReservationInput) =>
  request<Reservation & { guestToken: string }>(`/public/shops/${encodeURIComponent(slug)}/reservations`, { method: "POST", body: JSON.stringify(input) });

export const getReservation = (id: string, token: string) =>
  request<Reservation>(`/public/reservations/${encodeURIComponent(id)}?k=${encodeURIComponent(token)}`, { cache: "no-store" });

export const cancelReservation = (id: string, token: string) =>
  request<Reservation>(`/public/reservations/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ token }) });

// ── Buyer ────────────────────────────────────────────────────────────────

/** Who the code is for: an email address (the default) or a phone number (SMS). */
export type LoginIdentity = { email: string } | { phone: string };

/** What the sign-in screen may offer - email always, SMS only once it is set up on the server. */
export const getAuthMethods = () => request<{ email: boolean; sms: boolean; pin?: boolean }>("/buyer-auth/methods");

export const requestCode = (who: LoginIdentity) =>
  request<{ sent: boolean; channel: "EMAIL" | "SMS"; identifier: string }>("/buyer-auth/request-code", { method: "POST", body: JSON.stringify(who) });

export const verifyCode = (who: LoginIdentity, code: string) =>
  request<{ accessToken: string; buyer: Buyer }>("/buyer-auth/verify", { method: "POST", body: JSON.stringify({ ...who, code }) });

export const buyerSignup = (phone: string, pin: string, name?: string) =>
  request<{ accessToken: string; buyer: Buyer }>("/buyer-auth/signup", { method: "POST", body: JSON.stringify({ phone, pin, ...(name?.trim() ? { name: name.trim() } : {}) }) });

export const buyerPinLogin = (phone: string, pin: string) =>
  request<{ accessToken: string; buyer: Buyer }>("/buyer-auth/login", { method: "POST", body: JSON.stringify({ phone, pin }) });

export const requestBuyerPinReset = (phone: string) =>
  request<{ sent: boolean; message: string }>("/buyer-auth/pin-reset/request", { method: "POST", body: JSON.stringify({ phone }) });

export const resetBuyerPin = (phone: string, code: string, pin: string) =>
  request<{ accessToken: string; buyer: Buyer }>("/buyer-auth/pin-reset/verify", { method: "POST", body: JSON.stringify({ phone, code, pin }) });

export const setBuyerPin = (token: string, pin: string, phone?: string) =>
  request<Buyer>("/buyer/me/pin", { method: "PATCH", token, body: JSON.stringify({ pin, ...(phone ? { phone } : {}) }) });

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

// The backup for when the shop's payment confirmation hasn't arrived on its own. It asks
// M-Pesa via Tuma, which costs the shop KES 1 a time - so the page only offers it after a
// wait, and the server limits it.
export const checkOrderPayment = (token: string, id: string) =>
  request<OrderCheck>(`/buyer/orders/${id}/check`, { method: "POST", token, body: "{}" });

export const payOrder = (token: string, id: string, paymentPhone?: string) =>
  request<Order>(`/buyer/orders/${id}/pay`, { method: "POST", token, body: JSON.stringify(paymentPhone ? { paymentPhone } : {}) });

export const cancelOrder = (token: string, id: string) =>
  request<Order>(`/buyer/orders/${id}/cancel`, { method: "POST", token, body: "{}" });

// ── Rider ────────────────────────────────────────────────────────────────

export const requestRiderCode = (email: string) =>
  request<{ sent: boolean; email: string }>("/rider-auth/request-code", { method: "POST", body: JSON.stringify({ email }) });

export const verifyRiderCode = (email: string, code: string) =>
  request<{ accessToken: string; rider: Rider }>("/rider-auth/verify", { method: "POST", body: JSON.stringify({ email, code }) });

export const riderSignup = (fullName: string, phone: string, pin: string) =>
  request<{ accessToken: string; rider: Rider }>("/rider-auth/signup", { method: "POST", body: JSON.stringify({ fullName, phone, pin }) });

export const riderPinLogin = (phone: string, pin: string) =>
  request<{ accessToken: string; rider: Rider }>("/rider-auth/login", { method: "POST", body: JSON.stringify({ phone, pin }) });

export const requestRiderPinReset = (phone: string) =>
  request<{ sent: boolean; message: string }>("/rider-auth/pin-reset/request", { method: "POST", body: JSON.stringify({ phone }) });

export const resetRiderPin = (phone: string, code: string, pin: string) =>
  request<{ accessToken: string; rider: Rider }>("/rider-auth/pin-reset/verify", { method: "POST", body: JSON.stringify({ phone, code, pin }) });

export const setRiderPin = (token: string, pin: string) => request<Rider>("/rider/me/pin", { method: "PATCH", token, body: JSON.stringify({ pin }) });

export const getRiderMe = (token: string) => request<Rider>("/rider/me", { token });

export interface RiderProfileInput {
  fullName?: string;
  phone?: string;
  vehicleType?: VehicleType;
  plateNumber?: string;
  area?: string;
}

export const updateRiderMe = (token: string, input: RiderProfileInput) =>
  request<Rider>("/rider/me", { method: "PATCH", token, body: JSON.stringify(input) });

// ── Delivery ─────────────────────────────────────────────────────────────

/** The delivery of a shopper's own order, or null if the shop hasn't asked for a rider yet. */
export const getOrderDelivery = (token: string, orderId: string) => request<BuyerDelivery | null>(`/buyer/orders/${orderId}/delivery`, { token });

export const acceptDeliveryQuote = (token: string, orderId: string, quoteId: string) =>
  request<BuyerDelivery>(`/buyer/orders/${orderId}/delivery/quotes/${quoteId}/accept`, { method: "POST", token, body: "{}" });

export const listOpenJobs = (token: string) => request<OpenJob[]>("/rider/jobs/open", { token });

export const listMyJobs = (token: string) => request<MyJob[]>("/rider/jobs/mine", { token });

export const quoteJob = (token: string, jobId: string, input: { fee: number; etaMinutes?: number; note?: string }) =>
  request<OpenJob>(`/rider/jobs/${jobId}/quote`, { method: "POST", token, body: JSON.stringify(input) });

export const withdrawQuote = (token: string, jobId: string) => request<{ withdrawn: boolean }>(`/rider/jobs/${jobId}/quote`, { method: "DELETE", token });

export const pickUpJob = (token: string, jobId: string) => request<MyJob>(`/rider/jobs/${jobId}/pickup`, { method: "POST", token, body: "{}" });

export const deliverJob = (token: string, jobId: string, input: { code: string; cashCollected?: number }) =>
  request<MyJob>(`/rider/jobs/${jobId}/deliver`, { method: "POST", token, body: JSON.stringify(input) });

// ── Tenant portal (renting from a landlord who uses Zaroda) ──────────────

export interface TenantLease {
  leaseId: string;
  status: "ACTIVE" | "ENDED";
  startDate: string;
  endedAt: string | null;
  property: { name: string; address: string | null };
  unit: string;
  monthlyRent: number;
  dueDay: number;
  outstanding: number;
  overdue: number;
  credit: number;
  nextDue: string | null;
  openInvoices: { id: string; description: string; dueDate: string; balance: number; status: "PAID" | "PARTIAL" | "OVERDUE" | "UNPAID" }[];
  payments: { id: string; receiptNumber: string; amount: number; method: string; paidAt: string }[];
  pendingPrompt: { id: string; amount: number } | null;
}

export interface TenantTenancy {
  tenantName: string;
  business: string;
  canPayByMpesa: boolean;
  paymentInstructions: string | null;
  leases: TenantLease[];
  maintenance: { id: string; title: string; status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED"; priority: string; reportedAt: string; resolvedAt: string | null }[];
}

export interface TenantMe {
  email: string | null;
  phone: string | null;
  tenancies: TenantTenancy[];
}

export interface TenantPrompt {
  id: string;
  status: "PENDING" | "PAID" | "FAILED" | "REVIEW";
  amount: number;
  mpesaReceipt: string | null;
  lastError: string | null;
  paymentId: string | null;
}

export interface TenantReceipt {
  receiptNumber: string;
  business: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  voided: boolean;
  tenant: { name: string };
  property: { name: string; address: string | null };
  unit: string;
  appliedTo: { description: string; amount: number }[];
  keptAsCredit: number;
  balanceAfter: number;
}

export interface TenantStatement {
  business: string;
  tenant: { name: string };
  property: { name: string; address: string | null };
  unit: string;
  startDate: string;
  monthlyRent: number;
  lines: { date: string; description: string; reference: string | null; charge: number; paid: number; balance: number }[];
  balance: number;
  printedOn: string;
}

/** What the sign-in screen may offer: email always, text message only when the server has it set up. */
export const getTenantSignInMethods = () => request<{ email: boolean; sms: boolean }>("/tenant-auth/methods");

/** Exactly one of email and phone. */
export const requestTenantCode = (identity: { email?: string; phone?: string }) =>
  request<{ sent: boolean; channel: "EMAIL" | "SMS"; identifier: string }>("/tenant-auth/request-code", { method: "POST", body: JSON.stringify(identity) });

export const verifyTenantCode = (identity: { email?: string; phone?: string }, code: string) =>
  request<{ accessToken: string; identifier: string; email: string | null }>("/tenant-auth/verify", { method: "POST", body: JSON.stringify({ ...identity, code }) });

export const getTenantMe = (token: string) => request<TenantMe>("/tenant-portal/me", { token });

export const tenantPay = (token: string, input: { leaseId: string; amount: number; phone?: string }) =>
  request<{ id: string; status: string; lastError: string | null }>("/tenant-portal/pay", { method: "POST", token, body: JSON.stringify(input) });

export const getTenantPrompt = (token: string, id: string) => request<TenantPrompt>(`/tenant-portal/prompts/${id}`, { token });

export const tenantReportProblem = (token: string, input: { leaseId: string; title: string; description?: string }) =>
  request<{ id: string; title: string; status: string }>("/tenant-portal/maintenance", { method: "POST", token, body: JSON.stringify(input) });

export const getTenantReceipt = (token: string, paymentId: string) => request<TenantReceipt>(`/tenant-portal/payments/${paymentId}`, { token });

export const getTenantStatement = (token: string, leaseId: string) => request<TenantStatement>(`/tenant-portal/leases/${leaseId}/statement`, { token });
