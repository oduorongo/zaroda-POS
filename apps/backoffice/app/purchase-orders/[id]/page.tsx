"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";

type Status = "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

interface LineItem {
  id: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: string | null;
  variant: { sku: string; quantityMode: "COUNT" | "WEIGHT"; product: { name: string } };
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
}

const STATUS_COLOR: Record<Status, string> = {
  DRAFT: "text-slate-400",
  ORDERED: "text-amber-400",
  PARTIALLY_RECEIVED: "text-blue-400",
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

  async function load() {
    try {
      const result = await apiGet<PurchaseOrder>(`/purchase-orders/${params.id}`);
      setOrder(result);
      setDrafts((prev) => {
        const next: Record<string, ReceiptDraft> = {};
        for (const l of result.lineItems) {
          next[l.id] = prev[l.id] ?? { quantity: "", batchNumber: "", expiryDate: "", trackBatch: false };
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
        const qty = Number(d?.quantity);
        if (!d || !Number.isFinite(qty) || qty <= 0) return null;
        return {
          lineItemId: l.id,
          quantity: qty,
          batchNumber: d.trackBatch && d.batchNumber.trim() ? d.batchNumber.trim() : undefined,
          expiryDate: d.trackBatch && d.expiryDate ? d.expiryDate : undefined,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    if (lines.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`/purchase-orders/${order.id}/receive`, { lines });
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
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <button onClick={() => router.push("/purchase-orders")} className="mb-4 text-blue-400 hover:underline">
          &larr; Purchase orders
        </button>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {!order && !error && <p className="text-slate-400">Loading...</p>}

        {order && (
          <>
            <h1 className="text-xl font-bold">{order.supplier.name}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {order.branch.name} · {new Date(order.createdAt).toLocaleString()} ·{" "}
              <span className={STATUS_COLOR[order.status]}>{order.status.replace("_", " ")}</span>
              {order.reference && ` · ref ${order.reference}`}
            </p>
            {order.notes && <p className="mt-1 text-sm text-slate-500">{order.notes}</p>}

            <section className="mt-6 overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-slate-400">
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
                      <tr key={l.id} className="border-t border-slate-800 align-top">
                        <td className="p-3">
                          {l.variant.product.name} <span className="text-slate-500">({l.variant.sku})</span>
                        </td>
                        <td className="p-3 text-right font-mono">{l.quantityOrdered}</td>
                        <td className="p-3 text-right font-mono">{l.quantityReceived}</td>
                        {canReceive && (
                          <td className="p-3">
                            {remaining <= 0 ? (
                              <span className="text-xs text-slate-500">fully received</span>
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
                                    className="w-24 rounded-md border border-slate-700 bg-slate-900 p-1.5 text-sm"
                                  />
                                  <label className="flex items-center gap-1 text-xs text-slate-400">
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
                                        className="w-24 rounded-md border border-slate-700 bg-slate-900 p-1.5 text-sm"
                                      />
                                      <input
                                        type="date"
                                        value={draft.expiryDate}
                                        onChange={(e) => updateDraft(l.id, { expiryDate: e.target.value })}
                                        className="rounded-md border border-slate-700 bg-slate-900 p-1.5 text-sm"
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

            {actionError && <p className="mt-4 text-sm text-red-400">{actionError}</p>}

            <div className="mt-4 flex gap-3">
              {canReceive && (
                <button
                  onClick={() => void receiveAll()}
                  disabled={busy}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
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
          </>
        )}
      </main>
    </div>
  );
}
