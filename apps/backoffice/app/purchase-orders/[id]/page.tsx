"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { PageHeader } from "../../../components/page-header";
import { variantLabel } from "../../../lib/variant-label";

type Status = "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

interface LineItem {
  id: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: string | null;
  variant: { sku: string; name?: string | null; quantityMode: "COUNT" | "WEIGHT"; product: { name: string } };
}

interface PurchaseOrder {
  id: string;
  status: Status;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  branch: { name: string };
  supplier: { name: string };
  lineItems: LineItem[];
}

interface ReceiptDraft {
  quantity: string;
  batchNumber: string;
  expiryDate: string;
  trackBatch: boolean;
  /** What was actually paid per unit; empty = the price on the order. */
  unitCost: string;
  /** Arrived broken, expired or wrong: not put into stock. */
  damaged: string;
}

interface Warning {
  variantId: string;
  name: string;
  price: number;
  cost: number;
  marginPercent: number;
  previousCost: number | null;
  reason: "BELOW_MINIMUM" | "LOSS" | "COST_UP";
}

interface ReceiptSummary {
  id: string;
  receiptNumber: string;
  createdAt: string;
  deliveryNote: string | null;
  lines: { id: string; name: string; quantityAccepted: number; quantityDamaged: number }[];
}

const STATUS_COLOR: Record<Status, string> = {
  DRAFT: "text-secondary-500",
  ORDERED: "text-amber-400",
  PARTIALLY_RECEIVED: "text-primary-400",
  RECEIVED: "text-green-400",
  CANCELLED: "text-red-400",
};

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [makeBill, setMakeBill] = useState(false);
  const [billNumber, setBillNumber] = useState("");
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [billMessage, setBillMessage] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);

  async function load() {
    try {
      const result = await apiGet<PurchaseOrder>(`/purchase-orders/${params.id}`);
      setOrder(result);
      apiGet<ReceiptSummary[]>(`/goods-receipts?purchaseOrderId=${params.id}`).then(setReceipts).catch(() => setReceipts([]));
      setDrafts((prev) => {
        const next: Record<string, ReceiptDraft> = {};
        for (const l of result.lineItems) {
          next[l.id] = prev[l.id] ?? { quantity: "", batchNumber: "", expiryDate: "", trackBatch: false, unitCost: "", damaged: "" };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this purchase order.");
    }
  }

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
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, params.id]);

  function updateDraft(lineId: string, patch: Partial<ReceiptDraft>) {
    setDrafts((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  async function receiveAll() {
    if (!order) return;
    const lines = order.lineItems
      .map((l) => {
        const d = drafts[l.id];
        const qty = Number(d?.quantity || 0);
        const bad = Number(d?.damaged || 0);
        if (!d || !Number.isFinite(qty) || !Number.isFinite(bad) || qty < 0 || bad < 0 || qty + bad <= 0) return null;
        return {
          lineItemId: l.id,
          quantity: qty,
          damaged: bad > 0 ? bad : undefined,
          batchNumber: d.trackBatch && d.batchNumber.trim() ? d.batchNumber.trim() : undefined,
          expiryDate: d.trackBatch && d.expiryDate ? d.expiryDate : undefined,
          unitCost: d.unitCost.trim() === "" ? undefined : Number(d.unitCost),
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    if (lines.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await apiPost<{ warnings: Warning[]; bill: { billNumber: string; total: number; dueDate: string } | null }>(`/purchase-orders/${order.id}/receive`, {
        lines,
        deliveryNote: deliveryNote.trim() || undefined,
        bill: makeBill ? { billNumber: billNumber.trim() || undefined } : undefined,
      });
      setWarnings(r.warnings ?? []);
      setBillMessage(r.bill ? `A bill of KES ${r.bill.total.toLocaleString()} (invoice ${r.bill.billNumber}) is due ${r.bill.dueDate}.` : null);
      setDeliveryNote("");
      setMakeBill(false);
      setBillNumber("");
      setDrafts({});
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not record the receipt.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!order) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPatch(`/purchase-orders/${order.id}/cancel`, {});
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not cancel this purchase order.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  const canReceive = order && (order.status === "ORDERED" || order.status === "PARTIALLY_RECEIVED");
  const canCancel = order && (order.status === "DRAFT" || order.status === "ORDERED");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl p-6">
        <button onClick={() => router.push("/purchase-orders")} className="mb-4 text-primary-400 hover:underline">
          &larr; Purchase orders
        </button>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {!order && !error && <p className="text-secondary-500">Loading...</p>}

        {order && (
          <>
            <h1 className="text-xl font-bold">{order.supplier.name}</h1>
            <p className="mt-1 text-sm text-secondary-500">
              {order.branch.name} · {new Date(order.createdAt).toLocaleString()} ·{" "}
              <span className={STATUS_COLOR[order.status]}>{order.status.replace("_", " ")}</span>
              {order.reference && ` · ref ${order.reference}`}
            </p>
            {order.notes && <p className="mt-1 text-sm text-secondary-500">{order.notes}</p>}

            <section className="mt-6 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-secondary-500">
                  <tr>
                    <th className="p-3">Product</th>
                    <th className="p-3 text-right">Ordered</th>
                    <th className="p-3 text-right">Received</th>
                    {canReceive && <th className="p-3">Receive now</th>}
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map((l) => {
                    const remaining = l.quantityOrdered - l.quantityReceived;
                    const draft = drafts[l.id];
                    return (
                      <tr key={l.id} className="border-t border-border align-top">
                        <td className="p-3">
                          {l.variant.name ? variantLabel(l.variant.product.name, l.variant) : l.variant.product.name} <span className="text-secondary-500">({l.variant.sku})</span>
                        </td>
                        <td className="p-3 text-right font-mono">{l.quantityOrdered}</td>
                        <td className="p-3 text-right font-mono">{l.quantityReceived}</td>
                        {canReceive && (
                          <td className="p-3">
                            {remaining <= 0 ? (
                              <span className="text-xs text-secondary-500">fully received</span>
                            ) : (
                              draft && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="number"
                                    min={l.variant.quantityMode === "WEIGHT" ? 0.001 : 1}
                                    step={l.variant.quantityMode === "WEIGHT" ? "0.001" : "1"}
                                    max={remaining}
                                    placeholder={`max ${remaining}`}
                                    value={draft.quantity}
                                    onChange={(e) => updateDraft(l.id, { quantity: e.target.value })}
                                    className="w-24 rounded-md border border-border bg-background p-1.5 text-sm"
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    inputMode="decimal"
                                    placeholder={l.unitCost != null ? `paid (order: ${Number(l.unitCost)})` : "price paid"}
                                    title="What you actually paid per unit. Leave empty to use the price on the order. The product's cost updates from this."
                                    value={draft.unitCost}
                                    onChange={(e) => updateDraft(l.id, { unitCost: e.target.value })}
                                    className="w-36 rounded-md border border-border bg-background p-1.5 text-sm"
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    placeholder="damaged"
                                    title="Arrived broken, expired or wrong: not added to stock, written on the receipt for a claim."
                                    value={draft.damaged}
                                    onChange={(e) => updateDraft(l.id, { damaged: e.target.value })}
                                    className="w-24 rounded-md border border-border bg-background p-1.5 text-sm"
                                  />
                                  <label className="flex items-center gap-1 text-xs text-secondary-500">
                                    <input
                                      type="checkbox"
                                      checked={draft.trackBatch}
                                      onChange={(e) => updateDraft(l.id, { trackBatch: e.target.checked })}
                                    />
                                    batch
                                  </label>
                                  {draft.trackBatch && (
                                    <>
                                      <input
                                        placeholder="batch #"
                                        value={draft.batchNumber}
                                        onChange={(e) => updateDraft(l.id, { batchNumber: e.target.value })}
                                        className="w-24 rounded-md border border-border bg-background p-1.5 text-sm"
                                      />
                                      <input
                                        type="date"
                                        value={draft.expiryDate}
                                        onChange={(e) => updateDraft(l.id, { expiryDate: e.target.value })}
                                        className="rounded-md border border-border bg-background p-1.5 text-sm"
                                      />
                                    </>
                                  )}
                                </div>
                              )
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {canReceive && (
              <div className="mt-4 space-y-2 rounded-lg border border-border p-3 text-sm">
                <label className="block text-xs text-secondary-500">Supplier delivery note / invoice no. (optional)</label>
                <input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} className="w-full rounded-md border border-border bg-background p-2 text-sm sm:w-1/2" />
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={makeBill} onChange={(e) => setMakeBill(e.target.checked)} />
                  Record what we now owe {order.supplier.name} (needs a price on every line received)
                </label>
                {makeBill && (
                  <input placeholder="Supplier invoice number (delivery note number if empty)" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} className="w-full rounded-md border border-border bg-background p-2 text-sm sm:w-1/2" />
                )}
              </div>
            )}

            {actionError && <p className="mt-4 text-sm text-red-400">{actionError}</p>}
            {billMessage && <p className="mt-4 text-sm text-emerald-400">{billMessage}</p>}
            {warnings.map((w) => (
              <p key={w.variantId} className="mt-2 rounded-md bg-amber-950 p-2 text-sm text-amber-200">
                {w.reason === "LOSS" ? "Selling at a loss: " : w.reason === "BELOW_MINIMUM" ? "Thin margin: " : "Cost went up: "}
                {w.name} now costs KES {w.cost.toLocaleString()} and sells for KES {w.price.toLocaleString()} ({w.marginPercent}% margin). Check its selling price.
              </p>
            ))}

            <div className="mt-4 flex gap-3">
              {canReceive && (
                <button
                  onClick={() => void receiveAll()}
                  disabled={busy}
                  className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold hover:bg-primary-500 disabled:opacity-40"
                >
                  {busy ? "Saving..." : "Record receipt"}
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => void cancel()}
                  disabled={busy}
                  className="rounded-md bg-red-900 px-4 py-2 text-sm hover:bg-red-800 disabled:opacity-40"
                >
                  Cancel order
                </button>
              )}
            </div>
            {receipts.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2 text-sm font-semibold text-secondary-600">Goods received against this order</h2>
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {receipts.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <span>
                        <Link href={`/goods-receipts/${r.id}`} className="font-mono text-primary-400 hover:underline">
                          {r.receiptNumber}
                        </Link>{" "}
                        · {new Date(r.createdAt).toLocaleDateString()}
                        {r.deliveryNote ? ` · delivery note ${r.deliveryNote}` : ""}
                      </span>
                      <span className="text-secondary-500">
                        {r.lines.reduce((s, l) => s + l.quantityAccepted, 0)} received
                        {r.lines.some((l) => l.quantityDamaged > 0) ? `, ${r.lines.reduce((s, l) => s + l.quantityDamaged, 0)} damaged` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
