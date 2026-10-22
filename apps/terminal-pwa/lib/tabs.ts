// Shapes and small helpers for open bills (running tabs) on the till.

export interface TabLine {
  id: string;
  variantId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
  stationId: string;
  stationName: string;
  courseNumber: number;
  notes: string | null;
  status: "ORDERED" | "PAID" | "VOIDED";
  voidReason: string | null;
}

export interface Tab {
  id: string;
  status: "OPEN" | "CLOSED" | "VOID";
  table: { id: string; label: string };
  openedAt: string;
  guestCount: number;
  lines: TabLine[];
  unpaidCount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface Bill {
  business: string;
  table: { id: string; label: string };
  openedAt: string;
  guestCount: number;
  lines: TabLine[];
  subtotal: number;
  tax: number;
  total: number;
  split: number[] | null;
  text: string;
}

export interface HeldCourse {
  source: "TAB" | "SALE";
  tabId: string | null;
  saleId: string | null;
  courseNumber: number;
  items: { title: string; quantity: number; station: string }[];
}

export const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The signed-in person's role, read from their token (only used to hide buttons - the server decides what is allowed). */
export function roleOf(token: string): string {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(payload)) as { role?: string }).role ?? "";
  } catch {
    return "";
  }
}
export const isSupervisor = (role: string) => role === "SUPERVISOR" || role === "MANAGER" || role === "OWNER";

export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Opens a plain page of the bill and the print dialog (also "save as PDF"). */
export function printBill(bill: Bill): void {
  const rows = bill.lines
    .map((l) => `<tr><td>${l.quantity} x ${escapeHtml(l.title)}</td><td style="text-align:right">${l.amount.toFixed(2)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${escapeHtml(bill.table.label)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:320px;margin:16px auto;font-size:14px}table{width:100%;border-collapse:collapse}td{padding:3px 0}h1{font-size:18px;margin:0}p{margin:4px 0}.tot td{border-top:1px solid #000;font-weight:bold;font-size:16px}</style></head>
<body><h1>${escapeHtml(bill.business)}</h1><p>${escapeHtml(bill.table.label)} - ${new Date(bill.openedAt).toLocaleString("en-KE")}</p><table>${rows}
<tr><td>Before VAT</td><td style="text-align:right">${bill.subtotal.toFixed(2)}</td></tr><tr><td>VAT</td><td style="text-align:right">${bill.tax.toFixed(2)}</td></tr>
<tr class="tot"><td>TOTAL (KES)</td><td style="text-align:right">${bill.total.toFixed(2)}</td></tr></table>
${bill.split ? `<p>Split ${bill.split.length} ways: KES ${bill.split[0].toFixed(2)} each</p>` : ""}<p style="margin-top:12px">Thank you!</p>
<script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

/** Shares the bill as text (the phone's share sheet, or the clipboard where there is none). Returns a message for the cashier. */
export async function shareBill(bill: Bill): Promise<string> {
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: `Bill ${bill.table.label}`, text: bill.text });
      return "Bill shared.";
    }
    await navigator.clipboard.writeText(bill.text);
    return "Bill copied - paste it into WhatsApp or a message.";
  } catch {
    return "Could not share the bill.";
  }
}
