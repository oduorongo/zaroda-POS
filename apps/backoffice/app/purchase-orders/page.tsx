"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

type Status = "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

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

interface Supplier {
  id: string;
  name: string;
}

interface PurchaseOrder {
  id: string;
  status: Status;
  reference: string | null;
  createdAt: string;
  branch: { name: string };
  supplier: Supplier;
  lineItems: { quantityOrdered: number; quantityReceived: number }[];
}

interface NewLine {
  variantId: string;
  label: string;
  quantityOrdered: number;
  quantityMode: "COUNT" | "WEIGHT";
}

const STATUS_COLOR: Record<Status, string> = {
  DRAFT: "text-slate-400",
  ORDERED: "text-amber-400",
  PARTIALLY_RECEIVED: "text-blue-400",
  RECEIVED: "text-green-400",
  CANCELLED: "text-red-400",
};

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branchId, setBranchId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<NewLine[]>([]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
    if (!session) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, statusFilter]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setOrders(
        await apiGet<PurchaseOrder[]>(`/purchase-orders${statusFilter ? `?status=${statusFilter}` : ""}`),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load purchase orders.");
    } finally {
      setLoading(false);
    }
  }

  async function openNew() {
    setFormOpen(true);
    setCreateError(null);
    try {
      const [branchResult, supplierResult, productResult] = await Promise.all([
        apiGet<Branch[]>("/branches"),
        apiGet<Supplier[]>("/suppliers"),
        apiGet<Product[]>("/products"),
      ]);
      setBranches(branchResult);
      setSuppliers(supplierResult);
      setProducts(productResult);
      setBranchId((prev) => prev || branchResult[0]?.id || "");
      setSupplierId((prev) => prev || supplierResult[0]?.id || "");
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not load branches, suppliers, or products.");
    }
  }

  const variantOptions = useMemo(() => {
    const flat = products.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } })));
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return flat
      .filter((v) => v.product.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term))
      .slice(0, 20);
  }, [products, search]);

  function addLine(v: Variant) {
    setLines((prev) => {
      if (prev.some((l) => l.variantId === v.id)) return prev;
      return [
        ...prev,
        { variantId: v.id, label: `${v.product.name} (${v.sku})`, quantityOrdered: 1, quantityMode: v.quantityMode },
      ];
    });
    setSearch("");
  }

  function updateLineQty(variantId: string, qty: number) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantityOrdered: qty } : l)));
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  async function createOrder() {
    if (!branchId.trim() || !supplierId.trim() || lines.length === 0) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await apiPost<{ id: string }>("/purchase-orders", {
        branchId,
        supplierId,
        reference: reference.trim() || undefined,
        lineItems: lines.map((l) => ({ variantId: l.variantId, quantityOrdered: l.quantityOrdered })),
      });
      router.push(`/purchase-orders/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create purchase order.");
    } finally {
      setCreateBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Purchase orders</h1>
          <div className="flex gap-2">
            <Link href="/suppliers" className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">
              Suppliers
            </Link>
            <button onClick={() => void openNew()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">
              + New purchase order
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["", "DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const).map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-sm ${statusFilter === s ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}
            >
              {s || "All"}
            </button>
          ))}
        </div>

        {formOpen && (
          <div className="mb-6 rounded-lg border border-slate-800 p-4">
            <h2 className="mb-3 font-semibold">New purchase order</h2>

            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs text-slate-400">Receiving branch</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                >
                  {branches.length === 0 && <option value="">No branches found</option>}
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">Supplier</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                >
                  {suppliers.length === 0 && <option value="">No suppliers - add one first</option>}
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">Reference (optional)</label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
            </div>

            <label className="block text-xs text-slate-400">Add product</label>
            <input
              placeholder="Search by product name or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
            />
            {search.trim() && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-700 bg-slate-900">
                {variantOptions.length === 0 ? (
                  <p className="p-2 text-sm text-slate-500">No matching products.</p>
                ) : (
                  variantOptions.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => addLine(v)}
                      className="block w-full px-2 py-1.5 text-left text-sm hover:bg-slate-800"
                    >
                      {v.product.name} <span className="text-slate-500">({v.sku})</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {lines.length > 0 && (
              <div className="mt-3 space-y-2">
                {lines.map((l) => (
                  <div key={l.variantId} className="flex items-center justify-between gap-2 rounded-md bg-slate-900 p-2 text-sm">
                    <span>{l.label}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={l.quantityMode === "WEIGHT" ? 0.001 : 1}
                        step={l.quantityMode === "WEIGHT" ? "0.001" : "1"}
                        value={l.quantityOrdered}
                        onChange={(e) => {
                          const min = l.quantityMode === "WEIGHT" ? 0.001 : 1;
                          updateLineQty(l.variantId, Math.max(min, Number(e.target.value) || min));
                        }}
                        className="w-24 rounded-md border border-slate-700 bg-slate-800 p-1 text-sm"
                      />
                      <button onClick={() => removeLine(l.variantId)} className="text-xs text-red-400 hover:text-red-300">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {createError && <p className="mt-2 text-sm text-red-400">{createError}</p>}
            <div className="mt-3 flex gap-3">
              <button onClick={() => setFormOpen(false)} className="rounded-md bg-slate-700 px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={() => void createOrder()}
                disabled={createBusy || !branchId.trim() || !supplierId.trim() || lines.length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
              >
                {createBusy ? "Creating..." : "Create purchase order"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}
        {!loading && orders.length === 0 && !error && <p className="text-slate-400">No purchase orders found.</p>}

        {orders.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="p-3">Supplier</th>
                  <th className="p-3">Branch</th>
                  <th className="p-3">Reference</th>
                  <th className="p-3">Created</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Lines</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const ordered = o.lineItems.reduce((sum, l) => sum + l.quantityOrdered, 0);
                  const received = o.lineItems.reduce((sum, l) => sum + l.quantityReceived, 0);
                  return (
                    <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                      <td className="p-3">{o.supplier.name}</td>
                      <td className="p-3">{o.branch.name}</td>
                      <td className="p-3">{o.reference ?? "-"}</td>
                      <td className="p-3">{new Date(o.createdAt).toLocaleString()}</td>
                      <td className={`p-3 ${STATUS_COLOR[o.status]}`}>{o.status.replace("_", " ")}</td>
                      <td className="p-3 text-right font-mono">
                        {received} / {ordered}
                      </td>
                      <td className="p-3 text-right">
                        <Link href={`/purchase-orders/${o.id}`} className="text-blue-400 hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
