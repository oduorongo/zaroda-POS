"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Variant {
  id: string;
  sku: string;
  product: { name: string };
}

interface InventoryItem {
  branchId: string;
  variantId: string;
  quantity: number;
  lowStockThreshold: number;
  variant: Variant;
}

interface LowStockAlert {
  id: string;
  branchId: string;
  variantId: string;
  status: string;
  createdAt: string;
  variant: Variant;
  branch: { name: string };
}

interface InventoryTransaction {
  id: string;
  type: string;
  quantityDelta: number;
  createdAt: string;
}

interface Conflict extends InventoryItem {
  branch: { name: string };
  recentTransactions: InventoryTransaction[];
}

type Tab = "items" | "alerts" | "conflicts";

const ADJUSTMENT_TYPES = ["ADJUSTMENT", "TRANSFER", "STOCKTAKE", "RETURN"];

/**
 * Requires a branchId typed in directly, same as the Reports page's
 * missing branch filter - no GET /branches (or any branch-listing
 * endpoint) exists anywhere in the API. Documented as a real gap rather
 * than hardcoding the demo org's branch id as if that generalized.
 */
export default function InventoryPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branchId, setBranchId] = useState("");
  const [tab, setTab] = useState<Tab>("items");

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adjVariantId, setAdjVariantId] = useState("");
  const [adjType, setAdjType] = useState("ADJUSTMENT");
  const [adjDelta, setAdjDelta] = useState("");
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!session || !branchId.trim()) return;
    void loadTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, branchId, tab, lowStockOnly]);

  async function loadTab() {
    setLoading(true);
    setError(null);
    try {
      if (tab === "items") {
        setItems(await apiGet<InventoryItem[]>(`/inventory/items?branchId=${branchId}${lowStockOnly ? "&lowStockOnly=true" : ""}`));
      } else if (tab === "alerts") {
        setAlerts(await apiGet<LowStockAlert[]>(`/inventory/alerts?branchId=${branchId}`));
      } else {
        setConflicts(await apiGet<Conflict[]>(`/inventory/conflicts?branchId=${branchId}`));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load inventory data.");
    } finally {
      setLoading(false);
    }
  }

  const lowStockCount = useMemo(() => items.filter((i) => i.quantity <= i.lowStockThreshold).length, [items]);

  async function submitAdjustment() {
    const delta = Number(adjDelta);
    if (!adjVariantId.trim() || !Number.isFinite(delta) || delta === 0) return;
    setAdjBusy(true);
    setAdjError(null);
    try {
      await apiPost("/inventory/transactions", {
        branchId,
        variantId: adjVariantId.trim(),
        type: adjType,
        quantityDelta: delta,
      });
      setAdjVariantId("");
      setAdjDelta("");
      setAdjOpen(false);
      await loadTab();
    } catch (err) {
      setAdjError(err instanceof ApiError ? err.message : "Could not record the adjustment.");
    } finally {
      setAdjBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-4 text-xl font-bold">Inventory</h1>

        <div className="mb-4">
          <label className="block text-xs text-slate-400">
            Branch ID (no branch picker exists yet - paste it directly)
          </label>
          <input
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            placeholder="Branch UUID"
            className="mt-1 w-full max-w-md rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
          />
        </div>

        {!branchId.trim() ? (
          <p className="text-slate-400">Enter a branch ID to load inventory data.</p>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={() => setTab("items")}
                  className={`rounded-md px-3 py-1.5 text-sm ${tab === "items" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}
                >
                  Stock levels{lowStockCount > 0 && tab === "items" ? ` (${lowStockCount} low)` : ""}
                </button>
                <button
                  onClick={() => setTab("alerts")}
                  className={`rounded-md px-3 py-1.5 text-sm ${tab === "alerts" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}
                >
                  Low-stock alerts
                </button>
                <button
                  onClick={() => setTab("conflicts")}
                  className={`rounded-md px-3 py-1.5 text-sm ${tab === "conflicts" ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}
                >
                  Conflicts
                </button>
              </div>
              <button onClick={() => setAdjOpen((v) => !v)} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700">
                + Record adjustment
              </button>
            </div>

            {adjOpen && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 p-3">
                <input
                  placeholder="Variant ID"
                  value={adjVariantId}
                  onChange={(e) => setAdjVariantId(e.target.value)}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
                <select
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value)}
                  className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                >
                  {ADJUSTMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Delta (+/-)"
                  value={adjDelta}
                  onChange={(e) => setAdjDelta(e.target.value)}
                  className="w-32 rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
                <button
                  onClick={() => void submitAdjustment()}
                  disabled={adjBusy || !adjVariantId.trim() || !Number.isFinite(Number(adjDelta)) || Number(adjDelta) === 0}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                >
                  {adjBusy ? "Saving..." : "Save"}
                </button>
                {adjError && <p className="w-full text-sm text-red-400">{adjError}</p>}
              </div>
            )}

            {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
            {loading && <p className="text-slate-400">Loading...</p>}

            {!loading && tab === "items" && (
              <>
                <label className="mb-2 flex items-center gap-2 text-sm text-slate-400">
                  <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
                  Low stock only
                </label>
                {items.length === 0 ? (
                  <p className="text-slate-400">No inventory records for this branch.</p>
                ) : (
                  <Table
                    columns={["Product", "SKU", "Qty", "Threshold"]}
                    rows={items.map((i) => [
                      i.variant.product.name,
                      i.variant.sku,
                      String(i.quantity),
                      String(i.lowStockThreshold),
                    ])}
                    highlightRow={(i) => items[i].quantity <= items[i].lowStockThreshold}
                  />
                )}
              </>
            )}

            {!loading && tab === "alerts" && (
              alerts.length === 0 ? (
                <p className="text-slate-400">No open low-stock alerts.</p>
              ) : (
                <Table
                  columns={["Product", "SKU", "Status", "Since"]}
                  rows={alerts.map((a) => [a.variant.product.name, a.variant.sku, a.status, new Date(a.createdAt).toLocaleString()])}
                />
              )
            )}

            {!loading && tab === "conflicts" && (
              conflicts.length === 0 ? (
                <p className="text-slate-400">No stock conflicts (oversells) for this branch.</p>
              ) : (
                <div className="space-y-3">
                  {conflicts.map((c) => (
                    <div key={c.variantId} className="rounded-lg border border-red-900 p-3">
                      <p className="font-semibold">
                        {c.variant.product.name} ({c.variant.sku}) - quantity {c.quantity}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">Recent ledger entries:</p>
                      {c.recentTransactions.map((t) => (
                        <p key={t.id} className="text-xs text-slate-400">
                          {t.type} {t.quantityDelta > 0 ? "+" : ""}
                          {t.quantityDelta} - {new Date(t.createdAt).toLocaleString()}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Table({
  columns,
  rows,
  highlightRow,
}: {
  columns: string[];
  rows: string[][];
  highlightRow?: (index: number) => boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-800 text-slate-400">
          <tr>
            {columns.map((c) => (
              <th key={c} className="p-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`border-t border-slate-800 ${highlightRow?.(i) ? "bg-amber-950/40" : ""}`}>
              {row.map((cell, j) => (
                <td key={j} className={`p-3 ${j > 0 ? "text-right font-mono" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
