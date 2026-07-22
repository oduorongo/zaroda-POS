"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
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

interface Repackaging {
  id: string;
  fromQuantity: number;
  toQuantity: number;
  notes: string | null;
  createdAt: string;
  branch: { name: string };
  fromVariant: Variant;
  toVariant: Variant;
}

function VariantPicker({
  label,
  products,
  selected,
  onSelect,
  exclude,
}: {
  label: string;
  products: Product[];
  selected: Variant | null;
  onSelect: (v: Variant) => void;
  exclude?: string;
}) {
  const [search, setSearch] = useState("");
  const options = useMemo(() => {
    const flat = products.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } })));
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return flat
      .filter((v) => v.id !== exclude)
      .filter((v) => v.product.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term))
      .slice(0, 20);
  }, [products, search, exclude]);

  return (
    <div>
      <label className="block text-xs text-slate-400">{label}</label>
      {selected ? (
        <div className="mt-1 flex items-center justify-between rounded-md bg-slate-900 p-2 text-sm">
          <span>
            {selected.product.name} <span className="text-slate-500">({selected.sku})</span>
          </span>
          <button
            onClick={() => onSelect({ id: "", sku: "", quantityMode: "COUNT", product: { name: "" } })}
            className="text-xs text-red-400"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            placeholder="Search by product name or SKU"
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

export default function RepackagingPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [history, setHistory] = useState<Repackaging[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [fromVariant, setFromVariant] = useState<Variant | null>(null);
  const [toVariant, setToVariant] = useState<Variant | null>(null);
  const [fromQuantity, setFromQuantity] = useState("1");
  const [toQuantity, setToQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function loadHistory() {
    setLoading(true);
    try {
      setHistory(await apiGet<Repackaging[]>(`/repackaging?branchId=${branchId}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not load repackaging history.");
    } finally {
      setLoading(false);
    }
  }

  const yieldPerUnit = useMemo(() => {
    const from = Number(fromQuantity);
    const to = Number(toQuantity);
    if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to) || to <= 0) return null;
    return to / from;
  }, [fromQuantity, toQuantity]);

  async function submit() {
    const from = Number(fromQuantity);
    const to = Number(toQuantity);
    setFormError(null);
    if (!branchId.trim() || !fromVariant?.id || !toVariant?.id) {
      setFormError("Pick both a bulk item and a resale item.");
      return;
    }
    if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to) || to <= 0) {
      setFormError("Quantities must be positive numbers.");
      return;
    }
    if (fromVariant.quantityMode === "COUNT" && !Number.isInteger(from)) {
      setFormError(`${fromVariant.sku} is sold by count - the bulk quantity must be a whole number.`);
      return;
    }
    if (toVariant.quantityMode === "COUNT" && !Number.isInteger(to)) {
      setFormError(`${toVariant.sku} is sold by count - the resale quantity must be a whole number.`);
      return;
    }
    setBusy(true);
    try {
      await apiPost("/repackaging", {
        branchId,
        fromVariantId: fromVariant.id,
        fromQuantity: from,
        toVariantId: toVariant.id,
        toQuantity: to,
        notes: notes.trim() || undefined,
      });
      setFromVariant(null);
      setToVariant(null);
      setFromQuantity("1");
      setToQuantity("");
      setNotes("");
      await loadHistory();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not record the repackaging.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-xl font-bold">Repackaging</h1>
        <p className="mb-4 text-sm text-slate-400">
          Break bulk stock (a jerrycan, a sack) down into smaller resale units (scoops, portions). Decrements the bulk
          item and credits the resale item in one move.
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
          <h2 className="mb-3 font-semibold">Record a repackaging</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <VariantPicker
              label="Bulk item (consumed)"
              products={products}
              selected={fromVariant}
              onSelect={(v) => setFromVariant(v.id ? v : null)}
              exclude={toVariant?.id}
            />
            <VariantPicker
              label="Resale item (produced)"
              products={products}
              selected={toVariant}
              onSelect={(v) => setToVariant(v.id ? v : null)}
              exclude={fromVariant?.id}
            />
            <div>
              <label className="block text-xs text-slate-400">
                Bulk quantity broken down{fromVariant?.quantityMode === "WEIGHT" ? " (e.g. kg)" : ""}
              </label>
              <input
                type="number"
                min={fromVariant?.quantityMode === "WEIGHT" ? 0.001 : 1}
                step={fromVariant?.quantityMode === "WEIGHT" ? "0.001" : "1"}
                value={fromQuantity}
                onChange={(e) => setFromQuantity(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">
                Resale quantity produced (total yield){toVariant?.quantityMode === "WEIGHT" ? " (e.g. kg)" : ""}
              </label>
              <input
                type="number"
                min={toVariant?.quantityMode === "WEIGHT" ? 0.001 : 1}
                step={toVariant?.quantityMode === "WEIGHT" ? "0.001" : "1"}
                placeholder="e.g. 100 scoops, or 12.5 (kg)"
                value={toQuantity}
                onChange={(e) => setToQuantity(e.target.value)}
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

          {yieldPerUnit !== null && (
            <p className="mt-2 text-xs text-slate-500">
              = {yieldPerUnit.toFixed(2)} resale unit(s) per bulk unit
            </p>
          )}

          {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}

          <button
            onClick={() => void submit()}
            disabled={busy || !branchId.trim() || !fromVariant?.id || !toVariant?.id}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? "Saving..." : "Record repackaging"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">History at this branch</h2>
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-500">No repackaging recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((r) => (
                <div key={r.id} className="rounded-md bg-slate-900 p-2 text-sm">
                  <p>
                    -{r.fromQuantity} {r.fromVariant.product.name} ({r.fromVariant.sku}) &rarr; +{r.toQuantity}{" "}
                    {r.toVariant.product.name} ({r.toVariant.sku})
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(r.createdAt).toLocaleString()}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
