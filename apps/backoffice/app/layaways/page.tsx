"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

type LayawayStatus = "OPEN" | "COMPLETED" | "CANCELLED";

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  loyaltyPoints: number;
}

interface Variant {
  id: string;
  sku: string;
  price: string;
}

interface Product {
  id: string;
  name: string;
  variants: Variant[];
}

interface Layaway {
  id: string;
  total: string;
  depositPaid: string;
  status: LayawayStatus;
  createdAt: string;
  customer: Customer;
}

interface NewLine {
  variantId: string;
  sku: string;
  productName: string;
  quantity: number;
}

const STATUS_COLOR: Record<LayawayStatus, string> = {
  OPEN: "text-amber-400",
  COMPLETED: "text-green-400",
  CANCELLED: "text-red-400",
};

export default function LayawaysPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [layaways, setLayaways] = useState<Layaway[]>([]);
  const [statusFilter, setStatusFilter] = useState<LayawayStatus | "">("OPEN");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newOpen, setNewOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [branchId, setBranchId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
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
      setLayaways(await apiGet<Layaway[]>(`/layaways${statusFilter ? `?status=${statusFilter}` : ""}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load layaways.");
    } finally {
      setLoading(false);
    }
  }

  async function openNew() {
    setNewOpen(true);
    setCreateError(null);
    try {
      setProducts(await apiGet<Product[]>("/products"));
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not load the catalog.");
    }
  }

  async function searchCustomers(q: string) {
    setCustomerSearch(q);
    try {
      setCustomerResults(await apiGet<Customer[]>(`/customers?search=${encodeURIComponent(q)}`));
    } catch {
      setCustomerResults([]);
    }
  }

  function addLine(product: Product, variant: Variant) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === variant.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { variantId: variant.id, sku: variant.sku, productName: product.name, quantity: 1 }];
    });
  }

  const estimatedTotal = useMemo(() => {
    let total = 0;
    for (const line of lines) {
      for (const product of products) {
        const variant = product.variants.find((v) => v.id === line.variantId);
        if (variant) total += Number(variant.price) * line.quantity;
      }
    }
    return total;
  }, [lines, products]);

  async function createLayaway() {
    if (!branchId.trim() || !selectedCustomer || lines.length === 0) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await apiPost<Layaway>("/layaways", {
        branchId: branchId.trim(),
        customerId: selectedCustomer.id,
        lineItems: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      });
      router.push(`/layaways/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create layaway.");
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
          <h1 className="text-xl font-bold">Layaways</h1>
          <button onClick={() => void openNew()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">
            + New layaway
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          {(["OPEN", "COMPLETED", "CANCELLED", ""] as const).map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-sm ${statusFilter === s ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}
            >
              {s || "All"}
            </button>
          ))}
        </div>

        {newOpen && (
          <div className="mb-6 rounded-lg border border-slate-800 p-4">
            <h2 className="mb-3 font-semibold">New layaway</h2>
            <label className="block text-xs text-slate-400">Branch ID (no branch picker exists yet)</label>
            <input
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              placeholder="Branch UUID"
              className="mt-1 mb-3 w-full max-w-md rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
            />

            {selectedCustomer ? (
              <div className="mb-3 flex items-center justify-between rounded-md bg-slate-900 p-2 text-sm">
                <span>{selectedCustomer.name}</span>
                <button onClick={() => setSelectedCustomer(null)} className="text-xs text-red-400">
                  Remove
                </button>
              </div>
            ) : (
              <>
                <input
                  placeholder="Search customer by name or phone..."
                  value={customerSearch}
                  onChange={(e) => void searchCustomers(e.target.value)}
                  className="mb-2 w-full max-w-md rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
                <div className="mb-3 max-h-32 max-w-md space-y-1 overflow-y-auto">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedCustomer(c);
                        setCustomerSearch("");
                        setCustomerResults([]);
                      }}
                      className="flex w-full items-center justify-between rounded-md bg-slate-900 p-2 text-left text-sm hover:bg-slate-800"
                    >
                      <span>{c.name}</span>
                      <span className="text-xs text-slate-400">{c.phone ?? "no phone"}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="mb-2 text-xs text-slate-400">Items:</p>
            <div className="mb-3 grid max-h-40 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {products.flatMap((p) =>
                p.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => addLine(p, v)}
                    className="rounded-md bg-slate-900 p-2 text-left text-xs hover:bg-slate-800"
                  >
                    {p.name} ({v.sku}) - KES {Number(v.price).toFixed(2)}
                  </button>
                )),
              )}
            </div>

            {lines.length > 0 && (
              <div className="mb-3 space-y-1">
                {lines.map((l) => (
                  <p key={l.variantId} className="text-sm">
                    {l.quantity}x {l.productName} ({l.sku})
                  </p>
                ))}
                <p className="text-sm font-semibold">Estimated total: KES {estimatedTotal.toFixed(2)}</p>
              </div>
            )}

            {createError && <p className="mb-2 text-sm text-red-400">{createError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setNewOpen(false)} className="rounded-md bg-slate-700 px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={() => void createLayaway()}
                disabled={createBusy || !branchId.trim() || !selectedCustomer || lines.length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
              >
                {createBusy ? "Creating..." : "Create layaway"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}
        {!loading && layaways.length === 0 && !error && <p className="text-slate-400">No layaways found.</p>}

        {layaways.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Created</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Paid / Total (KES)</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {layaways.map((l) => (
                  <tr key={l.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="p-3">{l.customer.name}</td>
                    <td className="p-3">{new Date(l.createdAt).toLocaleString()}</td>
                    <td className={`p-3 ${STATUS_COLOR[l.status]}`}>{l.status}</td>
                    <td className="p-3 text-right font-mono">
                      {Number(l.depositPaid).toFixed(2)} / {Number(l.total).toFixed(2)}
                    </td>
                    <td className="p-3 text-right">
                      <Link href={`/layaways/${l.id}`} className="text-blue-400 hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
