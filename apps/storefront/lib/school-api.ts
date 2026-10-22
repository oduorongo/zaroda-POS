import { API_URL, ApiError } from "./api";
import type { DocInvoice, DocOrder, DocReceipt, DocStatement } from "@zaroda/ui";

// A school's own sign-in and ordering, against the supplier's portal. Separate from the shopper calls: a school token is a
// different kind of token and only works on /school-portal.

async function call<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...rest.headers },
    });
  } catch {
    throw new ApiError("Could not reach the supplier right now - check your connection and try again.", 0);
  }
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof json === "object" && json && "message" in json ? (json as { message: unknown }).message : null;
    const message = Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" ? raw : `Something went wrong (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

export interface SchoolMe {
  school: { id: string; name: string; contactName: string | null; creditLimit: number | null; creditDays: number; owed: number; overdue: number; credit: number };
  supplier: { name: string; phone: string | null; email: string | null };
}
export interface PriceItem {
  variantId: string;
  title: string;
  sku: string;
  category: string | null;
  unitPrice: number;
  taxRate: number;
  allowsFractions: boolean;
}
export interface OrderLine {
  id: string;
  title: string;
  unitPrice: number;
  quantityOrdered: number;
  quantityConfirmed: number | null;
  quantityDelivered: number | null;
}
export interface SchoolOrder {
  id: string;
  orderNumber: string;
  lpoNumber: string | null;
  status: "SUBMITTED" | "CONFIRMED" | "DELIVERED" | "CANCELLED";
  submittedAt: string;
  confirmationNote: string | null;
  deliveryNoteNumber: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  invoice: { id: string; invoiceNumber: string; total: number } | null;
  lines: OrderLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
}
export interface SchoolInvoice {
  id: string;
  invoiceNumber: string;
  status: "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";
  issueDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  balance: number;
}
export interface SchoolReceipt {
  id: string;
  receiptNumber: string;
  status: "RECEIVED" | "BOUNCED";
  amount: number;
  method: string;
  reference: string | null;
  receivedOn: string;
}

export const schoolPortalInfo = (slug: string) => call<{ displayName: string } | null>(`/school-auth/portal/${encodeURIComponent(slug)}`);
export const schoolLogin = (slug: string, phone: string, pin: string) =>
  call<{ accessToken: string; school: { id: string; name: string }; supplierName: string }>("/school-auth/login", { method: "POST", body: JSON.stringify({ slug, phone, pin }) });
export const schoolMe = (token: string) => call<SchoolMe>("/school-portal/me", { token });
export const schoolPriceList = (token: string) => call<PriceItem[]>("/school-portal/price-list", { token });
export const schoolSubmitOrder = (token: string, body: { lpoNumber?: string; notes?: string; deliveryAddress?: string; requestedDate?: string; lines: { variantId: string; quantity: number }[] }) =>
  call<SchoolOrder>("/school-portal/orders", { token, method: "POST", body: JSON.stringify(body) });
export const schoolOrders = (token: string) => call<SchoolOrder[]>("/school-portal/orders", { token });
export const schoolCancelOrder = (token: string, id: string, reason: string) => call<SchoolOrder>(`/school-portal/orders/${id}/cancel`, { token, method: "POST", body: JSON.stringify({ reason }) });
export const schoolInvoices = (token: string) => call<SchoolInvoice[]>("/school-portal/invoices", { token });
export const schoolReceipts = (token: string) => call<SchoolReceipt[]>("/school-portal/receipts", { token });
export const schoolStatement = (token: string) => call<DocStatement>("/school-portal/statement", { token });
export const schoolInvoiceDoc = (token: string, id: string) => call<DocInvoice>(`/school-portal/invoices/${id}`, { token });
export const schoolOrderDoc = (token: string, id: string) => call<DocOrder>(`/school-portal/orders/${id}`, { token });
export const schoolReceiptDoc = (token: string, id: string) => call<DocReceipt>(`/school-portal/receipts/${id}`, { token });
