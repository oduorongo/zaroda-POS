"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Line {
  id: string;
  title: string;
  sku: string;
  unitPrice: number;
  quantityOrdered: number;
  quantityConfirmed: number | null;
  /** Everything delivered so far. */
  quantityDelivered: number;
  /** Still to come. */
  balance: number;
  lineTotal: number;
}
interface Delivery {
  id: string;
  sequence: number;
  deliveryNoteNumber: string;
  deliveredAt: string;
  receivedByName: string;
  schoolConfirmedAt: string | null;
  schoolConfirmedBy: string | null;
  invoice: { id: string; invoiceNumber: string; total: number } | null;
  lines: { lineId: string; title: string; quantity: number }[];
}
interface Order {
  id: string;
  orderNumber: string;
  lpoNumber: string | null;
  lpoVerifiedAt: string | null;
  lpoVerifiedByName: string | null;
  status: "SUBMITTED" | "CONFIRMED" | "PARTIALLY_DELIVERED" | "DELIVERED" | "CANCELLED";
  school: { id: string; name: string; phone: string };
  notes: string | null;
  deliveryAddress: string | null;
  requestedDate: string | null;
  overCreditLimit: boolean;
  submittedAt: string;
  confirmationNote: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  balanceClosedNote: string | null;
  hasBalance: boolean;
  deliveries: Delivery[];
  lines: Line[];
  subtotal: number;
  taxAmount: number;
  total: number;
}
interface Branch {
  id: string;
  name: string;
}

/** What the supplier is being asked to send on a line right now: what was asked (new order), what was agreed (confirmed) or what is left (partly delivered). */
const wanted = (o: Order, l: Line) => (o.status === "SUBMITTED" ? l.quantityOrdered : o.status === "CONFIRMED" ? (l.quantityConfirmed ?? l.quantityOrdered) : l.balance);
/** How much of a line cannot be supplied from stock. For a new order the stock already promised to other confirmed orders is not counted as available. */
const shortOf = (o: Order, l: Line, stock: Record<string, number>, reserved: Record<string, number>) => {
  const onShelf = stock[l.id] ?? 0;
  const free = o.status === "SUBMITTED" ? Math.max(0, onShelf - (reserved[l.id] ?? 0)) : onShelf;
  return Math.max(0, Math.round((wanted(o, l) - free) * 1000) / 1000);
};
const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const STATUS_LABEL: Record<Order["status"], string> = { SUBMITTED: "Waiting for you", CONFIRMED: "Confirmed", PARTIALLY_DELIVERED: "Balance to deliver", DELIVERED: "Delivered", CANCELLED: "Cancelled" };
const STATUS_TONE: Record<Order["status"], string> = { SUBMITTED: "bg-amber-900 text-amber-200", CONFIRMED: "bg-blue-900 text-blue-200", PARTIALLY_DELIVERED: "bg-orange-900 text-orange-200", DELIVERED: "bg-green-900 text-green-200", CANCELLED: "bg-secondary-500/20 text-secondary-500" };
const FILTERS: [string, string][] = [
  ["SUBMITTED", "Waiting"],
  ["CONFIRMED", "To deliver"],
  ["PARTIALLY_DELIVERED", "Balance to deliver"],
  ["DELIVERED", "Delivered"],
  ["CANCELLED", "Cancelled"],
  ["", "All"],
];

/** Orders from schools: confirm what you can supply, then deliver with a delivery note and invoice. */
export default function SchoolOrdersPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [filter, setFilter] = useState("SUBMITTED");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Working copy of the quantities, keyed by line id, and the delivery form
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [branchId, setBranchId] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [reason, setReason] = useState("");
  // What is in stock at the chosen branch for each line of the open order (line id -> quantity), once known
  const [stock, setStock] = useState<Record<string, number> | null>(null);
  // and how much of it other confirmed orders are still waiting for
  const [reserved, setReserved] = useState<Record<string, number>>({});

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      setOrders(await apiGet<Order[]>(`/school-supplier/orders${filter ? `?status=${filter}` : ""}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the orders.");
    }
  }, [filter]);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void apiGet<Branch[]>("/branches")
      .then((b) => {
        setBranches(b);
        setBranchId((cur) => cur || b[0]?.id || "");
      })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  useEffect(() => {
    const o = orders?.find((x) => x.id === openId);
    if (!o || !branchId || o.status === "DELIVERED" || o.status === "CANCELLED") {
      setStock(null);
      return;
    }
    let live = true;
    apiGet<{ lines: { lineId: string; available: number; reserved: number }[] }>(`/school-supplier/orders/${o.id}/stock?branchId=${branchId}`)
      .then((r) => {
        if (!live) return;
        const have = Object.fromEntries(r.lines.map((l) => [l.lineId, l.available]));
        setStock(have);
        setReserved(Object.fromEntries(r.lines.map((l) => [l.lineId, l.reserved])));
        // a delivery can only carry what is in stock: start from that, so there is nothing to fix before pressing Deliver
        if (o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED")
          setQtys(Object.fromEntries(o.lines.map((l) => [l.id, String(Math.min(wanted(o, l), have[l.id] ?? 0))])));
      })
      .catch(() => live && setStock(null));
    return () => {
      live = false;
    };
  }, [openId, branchId, orders]);

  function open(o: Order) {
    if (openId === o.id) {
      setOpenId(null);
      return;
    }
    setOpenId(o.id);
    setNote("");
    setReason("");
    setReceivedBy("");
    setNotice(null);
    setQtys(Object.fromEntries(o.lines.map((l) => [l.id, String(o.status === "CONFIRMED" ? (l.quantityConfirmed ?? l.quantityOrdered) : o.status === "PARTIALLY_DELIVERED" ? l.balance : l.quantityOrdered)])));
  }

  const lineBody = (o: Order) => o.lines.map((l) => ({ lineId: l.id, quantity: Number(qtys[l.id] ?? 0) }));

  async function act(path: string, body: unknown, done: string, closeAfter = true) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPost(path, body);
      setNotice(done);
      if (closeAfter) setOpenId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">School orders</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/schools" className="text-primary-600 hover:underline">Schools</Link>
            <Link href="/school-prices" className="text-primary-600 hover:underline">Price list</Link>
            <Link href="/school-quotes" className="text-primary-600 hover:underline">Quotations</Link>
            <Link href="/school-money" className="text-primary-600 hover:underline">Invoices &amp; payments</Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([key, label]) => (
            <button key={label} onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1 text-sm ${filter === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
              {label}
            </button>
          ))}
        </div>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        {!orders && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {orders && orders.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No orders here.</p>}

        <ul className="space-y-3">
          {orders?.map((o) => (
            <li key={o.id} className="rounded-lg border border-border bg-surface">
              <button onClick={() => open(o)} className="flex w-full flex-wrap items-start justify-between gap-2 p-3 text-left">
                <div>
                  <p className="font-semibold">
                    {o.school.name} <span className="font-mono text-xs text-secondary-500">{o.orderNumber}</span>
                  </p>
                  <p className="text-xs text-secondary-500">
                    {new Date(o.submittedAt).toLocaleString("en-KE")}
                    {o.lpoNumber ? ` · LPO ${o.lpoNumber}` : ""}
                    {o.requestedDate ? ` · wanted by ${o.requestedDate}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                  <p className="mt-1 font-mono font-semibold">{kes(o.total)}</p>
                  {o.overCreditLimit && o.status === "SUBMITTED" && <p className="text-xs text-red-400">Over their credit limit</p>}
                </div>
              </button>

              {openId === o.id && (
                <div className="space-y-3 border-t border-border p-3 text-sm">
                  {o.notes && <p className="text-secondary-600">School&apos;s note: {o.notes}</p>}
                  {o.deliveryAddress && <p className="text-secondary-600">Deliver to: {o.deliveryAddress}</p>}
                  {o.lpoNumber && (
                    <label className="flex flex-wrap items-center gap-2 text-secondary-600">
                      <input
                        type="checkbox"
                        disabled={!canEdit || busy || o.status === "CANCELLED"}
                        checked={o.lpoVerifiedAt !== null}
                        onChange={(e) => void act(`/school-supplier/orders/${o.id}/lpo-check`, { checked: e.target.checked }, e.target.checked ? "LPO ticked as received and checked." : "LPO tick taken off.", false)}
                      />
                      LPO {o.lpoNumber} received and checked against the school&apos;s signed copy
                      {o.lpoVerifiedAt && <span className="text-xs text-green-400">- {o.lpoVerifiedByName}, {new Date(o.lpoVerifiedAt).toLocaleDateString("en-KE")}</span>}
                      {!o.lpoVerifiedAt && (o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED") && <span className="text-xs text-amber-400">- not checked yet</span>}
                    </label>
                  )}
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-xs uppercase text-secondary-500">
                        <th className="py-1">Item</th>
                        <th className="py-1 text-right">Price</th>
                        <th className="py-1 text-right">Asked</th>
                        {o.status !== "SUBMITTED" && <th className="py-1 text-right">Confirmed</th>}
                        {o.deliveries.length > 0 && <th className="py-1 text-right">Delivered</th>}
                        {o.hasBalance && <th className="py-1 text-right">Balance</th>}
                        {stock && (o.status === "SUBMITTED" || o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED") && <th className="py-1 text-right">In stock</th>}
                        {stock && o.status === "SUBMITTED" && <th className="py-1 text-right">Promised to others</th>}
                        {stock && (o.status === "SUBMITTED" || o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED") && <th className="py-1 text-right">Short by</th>}
                        {(o.status === "SUBMITTED" || o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED") && canEdit && <th className="py-1 text-right">{o.status === "SUBMITTED" ? "You supply" : "Deliver now"}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {o.lines.map((l) => (
                        <tr key={l.id} className="border-t border-border">
                          <td className="py-1">{l.title}</td>
                          <td className="py-1 text-right font-mono">{l.unitPrice.toFixed(2)}</td>
                          <td className="py-1 text-right">{l.quantityOrdered}</td>
                          {o.status !== "SUBMITTED" && <td className="py-1 text-right">{l.quantityConfirmed ?? "-"}</td>}
                          {o.deliveries.length > 0 && <td className="py-1 text-right">{l.quantityDelivered}</td>}
                          {o.hasBalance && <td className="py-1 text-right font-semibold">{l.balance > 0 ? l.balance : "-"}</td>}
                          {stock && (o.status === "SUBMITTED" || o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED") && (
                            <>
                              <td className="py-1 text-right">{stock[l.id] ?? 0}</td>
                              {o.status === "SUBMITTED" && <td className="py-1 text-right text-secondary-500">{(reserved[l.id] ?? 0) > 0 ? reserved[l.id] : "-"}</td>}
                              <td className={`py-1 text-right font-semibold ${shortOf(o, l, stock, reserved) > 0 ? "text-red-400" : "text-secondary-500"}`}>{shortOf(o, l, stock, reserved) > 0 ? shortOf(o, l, stock, reserved) : "-"}</td>
                            </>
                          )}
                          {(o.status === "SUBMITTED" || o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED") && canEdit && (
                            <td className="py-1 text-right">
                              <input
                                type="number"
                                min={0}
                                max={o.status === "SUBMITTED" ? l.quantityOrdered : o.status === "CONFIRMED" ? (l.quantityConfirmed ?? l.quantityOrdered) : l.balance}
                                step="any"
                                value={qtys[l.id] ?? ""}
                                onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value }))}
                                className="w-24 rounded-md border border-border bg-surface p-1 text-right"
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {stock && (o.status === "SUBMITTED" || o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED") && o.lines.some((l) => shortOf(o, l, stock, reserved) > 0) && (
                    <p className="rounded-md bg-amber-950 p-2 text-xs text-amber-200">
                      {o.lines.filter((l) => shortOf(o, l, stock, reserved) > 0).length} of {o.lines.length} items are short of stock{branches.length > 1 ? ` at ${branches.find((b) => b.id === branchId)?.name ?? "this branch"}` : ""}.{" "}
                      {o.status === "SUBMITTED"
                        ? "Stock already promised to other confirmed orders is not counted as available. You can confirm less than was asked, or receive more stock first."
                        : "\"Deliver now\" starts from what you have in stock. The rest stays on the order as the balance, to deliver once stock arrives."}
                    </p>
                  )}
                  <p className="text-right text-xs text-secondary-500">
                    Before VAT {kes(o.subtotal)} · VAT {kes(o.taxAmount)} · <span className="font-semibold text-foreground">Total {kes(o.total)}</span>
                  </p>

                  {o.status === "SUBMITTED" && canEdit && (
                    <div className="space-y-2">
                      <label className="block">
                        Message to the school <span className="text-secondary-500">(optional)</span>
                        <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Only 80 books today" className={field} />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button disabled={busy} onClick={() => void act(`/school-supplier/orders/${o.id}/confirm`, { lines: lineBody(o), note: note.trim() || undefined }, `Order ${o.orderNumber} confirmed. The school has been told.`)} className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                          Confirm order
                        </button>
                      </div>
                    </div>
                  )}

                  {(o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED") && canEdit && (
                    <div className="space-y-2">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {branches.length > 1 && (
                          <label>
                            Take stock from
                            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field}>
                              {branches.map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label>
                          Received at the school by
                          <input maxLength={100} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of the person who took the goods" className={field} />
                        </label>
                      </div>
                      <p className="text-xs text-secondary-500">Each delivery takes the goods out of stock, makes its own delivery note and invoice, and is recorded as a sale. To send only part now, lower the numbers in &quot;Deliver now&quot;: what is left stays on the order as the balance, to deliver later.</p>
                      <button disabled={busy || !branchId || receivedBy.trim().length < 2 || !o.lines.some((l) => Number(qtys[l.id] ?? 0) > 0)} onClick={() => void act(`/school-supplier/orders/${o.id}/deliver`, { branchId, receivedByName: receivedBy.trim(), lines: lineBody(o) }, `Delivered. Delivery note and invoice made for ${o.orderNumber}. If anything was left out it stays as the balance.`)} className="rounded-md bg-green-700 px-4 py-2 font-semibold text-white hover:bg-green-800 disabled:opacity-50">
                        Deliver and make invoice
                      </button>
                    </div>
                  )}

                  {(o.status === "SUBMITTED" || o.status === "CONFIRMED") && canEdit && (
                    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                      <label className="flex-1">
                        Cancel this order - reason
                        <input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Out of stock" className={field} />
                      </label>
                      <button disabled={busy || reason.trim().length < 3} onClick={() => void act(`/school-supplier/orders/${o.id}/cancel`, { reason: reason.trim() }, `Order ${o.orderNumber} cancelled.`)} className="rounded-md border border-error-600 px-3 py-2 text-error-600 hover:bg-red-950 disabled:opacity-50">
                        Cancel order
                      </button>
                    </div>
                  )}

                  {o.status === "PARTIALLY_DELIVERED" && canEdit && (
                    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                      <label className="flex-1">
                        Will not deliver the balance - reason
                        <input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Out of stock, the school agreed to leave it" className={field} />
                      </label>
                      <button disabled={busy || reason.trim().length < 3} onClick={() => void act(`/school-supplier/orders/${o.id}/close-balance`, { note: reason.trim() }, `Order ${o.orderNumber} closed with what was delivered.`)} className="rounded-md border border-error-600 px-3 py-2 text-error-600 hover:bg-red-950 disabled:opacity-50">
                        Close order without the balance
                      </button>
                    </div>
                  )}

                  {o.balanceClosedNote && <p className="text-secondary-600">Closed without the balance: {o.balanceClosedNote}</p>}
                  {o.deliveries.length > 0 && (
                    <div className="space-y-2 border-t border-border pt-3">
                      <p className="text-xs uppercase text-secondary-500">Deliveries</p>
                      {o.deliveries.map((d) => (
                        <div key={d.id} className="rounded-md border border-border p-2">
                          <p className="text-secondary-600">
                            {d.sequence}. {new Date(d.deliveredAt).toLocaleDateString("en-KE")} · received by {d.receivedByName} · {d.lines.map((l) => `${l.quantity} ${l.title}`).join(", ")}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-4">
                            <Link href={`/school-print/delivery-note/${d.id}`} target="_blank" className="text-primary-600 hover:underline">
                              Delivery note {d.deliveryNoteNumber}
                            </Link>
                            {d.invoice && (
                              <Link href={`/school-print/invoice/${d.invoice.id}`} target="_blank" className="text-primary-600 hover:underline">
                                Invoice {d.invoice.invoiceNumber} · {kes(d.invoice.total)}
                              </Link>
                            )}
                            {d.schoolConfirmedAt ? (
                              <span className="text-green-400">School confirmed receipt ({d.schoolConfirmedBy})</span>
                            ) : (
                              <span className="text-secondary-500">School has not confirmed receipt yet</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {o.status === "CANCELLED" && (
                    <p className="text-secondary-600">
                      Cancelled by {o.cancelledBy === "SCHOOL" ? "the school" : "you"}: {o.cancelReason}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
