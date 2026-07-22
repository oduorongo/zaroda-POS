"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Variant {
  id: string;
  sku: string;
  quantityMode: "COUNT" | "WEIGHT";
  product: { name: string };
}

interface Product {
  id: string;
  name: string;
  variants: Variant[];
}

interface Branch {
  id: string;
  name: string;
}

type Status = "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

interface ProductionOrder {
  id: string;
  plannedQuantity: number;
  actualQuantity: number | null;
  status: Status;
  notes: string | null;
  createdAt: string;
  branch: { name: string };
  variant: Variant;
}

function VariantPicker({
  products,
  selected,
  onSelect,
}: {
  products: Product[];
  selected: Variant | null;
  onSelect: (v: Variant | null) => void;
}) {
  const [search, setSearch] = useState("");
  const options = useMemo(() => {
    const flat = products.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } })));
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return flat
      .filter((v) => v.product.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term))
      .slice(0, 20);
  }, [products, search]);

  return (
    <div>
      <label className="block text-xs text-slate-400">Finished good</label>
      {selected ? (
        <div className="mt-1 flex items-center justify-between rounded-md bg-slate-900 p-2 text-sm">
          <span>
            {selected.product.name} <span className="text-slate-500">({selected.sku})</span>
          </span>
          <button onClick={() => onSelect(null)} className="text-xs text-red-400">
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            placeholder="Search by product name or SKU - must have a recipe (BOM) set"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
          />
          {search.trim() && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-700 bg-slate-900">
              {options.length === 0 ? (
                <p className="p-2 text-sm text-slate-500">No matching products.</p>
              ) : (
                options.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      onSelect(v);
                      setSearch("");
                    }}
                    className="block w-full px-2 py-1.5 text-left text-sm hover:bg-slate-800"
                  >
                    {v.product.name} <span className="text-slate-500">({v.sku})</span>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ManufacturingPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [variant, setVariant] = useState<Variant | null>(null);
  const [plannedQuantity, setPlannedQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actualByOrder, setActualByOrder] = useState<Record<string, string>>({});

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void (async () => {
      try {
        const [branchResult, productResult] = await Promise.all([
          apiGet<Branch[]>("/branches"),
          apiGet<Product[]>("/products"),
        ]);
        setBranches(branchResult);
        setBranchId((prev) => prev || branchResult[0]?.id || "");
        setProducts(productResult);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "Could not load branches or products.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!branchId.trim()) return;
    void loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function loadOrders() {
    setLoading(true);
    try {
      setOrders(await apiGet<ProductionOrder[]>(`/production-orders?branchId=${branchId}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not load production orders.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const planned = Number(plannedQuantity);
    setFormError(null);
    if (!branchId.trim() || !variant?.id) {
      setFormError("Pick a finished good to produce.");
      return;
    }
    if (!Number.isFinite(planned) || planned <= 0) {
      setFormError("Planned quantity must be a positive number.");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/production-orders", {
        branchId,
        variantId: variant.id,
        plannedQuantity: planned,
        notes: notes.trim() || undefined,
      });
      setVariant(null);
      setPlannedQuantity("1");
      setNotes("");
      await loadOrders();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not raise the production order.");
    } finally {
      setBusy(false);
    }
  }

  async function start(id: string) {
    try {
      await apiPatch(`/production-orders/${id}/start`, {});
      await loadOrders();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not start the production order.");
    }
  }

  async function complete(id: string) {
    const actualQuantity = Number(actualByOrder[id]);
    if (!Number.isFinite(actualQuantity) || actualQuantity <= 0) {
      setLoadError("Enter the actual yield before completing this order.");
      return;
    }
    try {
      await apiPatch(`/production-orders/${id}/complete`, { actualQuantity });
      await loadOrders();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not complete the production order.");
    }
  }

  async function cancel(id: string) {
    try {
      await apiPatch(`/production-orders/${id}/cancel`, {});
      await loadOrders();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not cancel the production order.");
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-xl font-bold">Production</h1>
        <p className="mb-4 text-sm text-slate-400">
          Turn raw materials into finished goods for sale. A production order consumes the finished good&apos;s
          recipe (bill of materials, set via Products &rarr; Recipe) and credits the finished good itself when
          completed.
        </p>

        {loadError && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{loadError}</p>}

        <div className="mb-4">
          <label className="block text-xs text-slate-400">Branch</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="mt-1 w-full max-w-md rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
          >
            {branches.length === 0 && <option value="">No branches found</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Raise a production order</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <VariantPicker products={products} selected={variant} onSelect={setVariant} />
            <div>
              <label className="block text-xs text-slate-400">
                Planned quantity{variant?.quantityMode === "WEIGHT" ? " (e.g. kg)" : ""}
              </label>
              <input
                type="number"
                min={variant?.quantityMode === "WEIGHT" ? 0.001 : 1}
                step={variant?.quantityMode === "WEIGHT" ? "0.001" : "1"}
                value={plannedQuantity}
                onChange={(e) => setPlannedQuantity(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400">Notes (optional)</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
          </div>

          {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}

          <button
            onClick={() => void submit()}
            disabled={busy || !branchId.trim() || !variant?.id}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? "Saving..." : "Raise production order"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Orders at this branch</h2>
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-slate-500">No production orders yet.</p>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <div key={o.id} className="rounded-md bg-slate-900 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p>
                      {o.variant.product.name} <span className="text-slate-500">({o.variant.sku})</span> - planned{" "}
                      {o.plannedQuantity}
                      {o.actualQuantity !== null ? `, actual ${o.actualQuantity}` : ""}
                    </p>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-400">
                      {o.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(o.createdAt).toLocaleString()}
                    {o.notes ? ` · ${o.notes}` : ""}
                  </p>

                  {(o.status === "DRAFT" || o.status === "IN_PROGRESS") && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {o.status === "DRAFT" && (
                        <button
                          onClick={() => void start(o.id)}
                          className="rounded-md bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
                        >
                          Start
                        </button>
                      )}
                      <input
                        type="number"
                        placeholder="Actual yield"
                        value={actualByOrder[o.id] ?? ""}
                        onChange={(e) => setActualByOrder((prev) => ({ ...prev, [o.id]: e.target.value }))}
                        className="w-28 rounded-md border border-slate-700 bg-slate-800 p-1 text-xs"
                      />
                      <button
                        onClick={() => void complete(o.id)}
                        className="rounded-md bg-emerald-700 px-3 py-1 text-xs hover:bg-emerald-600"
                      >
                        Complete
                      </button>
                      <button
                        onClick={() => void cancel(o.id)}
                        className="rounded-md bg-red-900 px-3 py-1 text-xs hover:bg-red-800"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
