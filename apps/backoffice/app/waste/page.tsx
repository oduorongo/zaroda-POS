"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

type QuantityMode = "COUNT" | "WEIGHT";
type WasteReason = "EXPIRED" | "DAMAGED" | "SPOILED" | "OVERPRODUCTION" | "OTHER";

const REASONS: WasteReason[] = ["EXPIRED", "DAMAGED", "SPOILED", "OVERPRODUCTION", "OTHER"];

interface Variant {
  id: string;
  sku: string;
  quantityMode: QuantityMode;
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

interface Batch {
  id: string;
  batchNumber: string;
  expiryDate: string | null;
}

interface RecipeIngredient {
  id: string;
  quantity: string;
  ingredientVariant: { sku: string; product: { name: string } };
}

interface WasteLog {
  id: string;
  quantity: string;
  reason: WasteReason;
  notes: string | null;
  totalCost: string | null;
  createdAt: string;
  variant: Variant;
  batch: { batchNumber: string } | null;
  ingredients: { quantity: string; ingredientVariant: { sku: string; product: { name: string } } }[];
}

export default function WastePage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [history, setHistory] = useState<WasteLog[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [variant, setVariant] = useState<Variant | null>(null);
  const [recipe, setRecipe] = useState<RecipeIngredient[] | null>(null);
  const [checkingRecipe, setCheckingRecipe] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState("");

  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<WasteReason>("EXPIRED");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
      setHistory(await apiGet<WasteLog[]>(`/waste?branchId=${branchId}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not load waste history.");
    } finally {
      setLoading(false);
    }
  }

  const searchOptions = useMemo(() => {
    const flat = products.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } })));
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return flat
      .filter((v) => v.product.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term))
      .slice(0, 20);
  }, [products, search]);

  async function pickVariant(v: Variant) {
    setVariant(v);
    setSearch("");
    setBatchId("");
    setBatches([]);
    setRecipe(null);
    setCheckingRecipe(true);
    try {
      const ingredients = await apiGet<RecipeIngredient[]>(`/recipes/${v.id}`);
      setRecipe(ingredients);
      if (ingredients.length === 0) {
        try {
          setBatches(await apiGet<Batch[]>(`/inventory/batches?variantId=${v.id}`));
        } catch {
          setBatches([]);
        }
      }
    } catch {
      setRecipe([]);
    } finally {
      setCheckingRecipe(false);
    }
  }

  function clearVariant() {
    setVariant(null);
    setRecipe(null);
    setBatches([]);
    setBatchId("");
  }

  async function submit() {
    const qty = Number(quantity);
    setFormError(null);
    if (!branchId.trim() || !variant) {
      setFormError("Pick a branch and a product first.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError("Quantity must be a positive number.");
      return;
    }
    if (variant.quantityMode === "COUNT" && !Number.isInteger(qty) && (recipe?.length ?? 0) === 0) {
      setFormError("This product is sold by count - quantity must be a whole number.");
      return;
    }
    setBusy(true);
    setSaved(false);
    try {
      await apiPost("/waste", {
        branchId,
        variantId: variant.id,
        quantity: qty,
        reason,
        notes: notes.trim() || undefined,
        batchId: batchId || undefined,
      });
      clearVariant();
      setQuantity("");
      setNotes("");
      setReason("EXPIRED");
      setSaved(true);
      await loadHistory();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not record the write-off.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  const isRecipeItem = (recipe?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Waste / spoilage</h1>
          <Link href="/reports" className="text-sm text-slate-400 hover:text-slate-200">
            View waste report &rarr;
          </Link>
        </div>

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
          <h2 className="mb-3 font-semibold">Record a write-off</h2>

          <label className="block text-xs text-slate-400">Product</label>
          {variant ? (
            <div className="mt-1 flex items-center justify-between rounded-md bg-slate-900 p-2 text-sm">
              <span>
                {variant.product.name} <span className="text-slate-500">({variant.sku})</span>
              </span>
              <button onClick={clearVariant} className="text-xs text-red-400">
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
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-700 bg-slate-900">
                  {searchOptions.length === 0 ? (
                    <p className="p-2 text-sm text-slate-500">No matching products.</p>
                  ) : (
                    searchOptions.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => void pickVariant(v)}
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

          {checkingRecipe && <p className="mt-2 text-xs text-slate-500">Checking recipe...</p>}
          {!checkingRecipe && isRecipeItem && (
            <p className="mt-2 rounded-md bg-amber-950 p-2 text-xs text-amber-400">
              This is a recipe-tracked dish - writing it off will decrement its ingredients (
              {recipe!.map((r) => `${r.ingredientVariant.product.name}`).join(", ")}), not its own stock.
            </p>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400">
                Quantity{variant?.quantityMode === "WEIGHT" && !isRecipeItem ? " (e.g. kg)" : ""}
              </label>
              <input
                type="number"
                min={variant?.quantityMode === "WEIGHT" && !isRecipeItem ? 0.001 : 1}
                step={variant?.quantityMode === "WEIGHT" && !isRecipeItem ? "0.001" : "1"}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as WasteReason)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {!isRecipeItem && batches.length > 0 && (
              <div>
                <label className="block text-xs text-slate-400">Batch (optional)</label>
                <select
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                >
                  <option value="">No specific batch</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNumber}
                      {b.expiryDate ? ` - exp ${new Date(b.expiryDate).toLocaleDateString()}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
          {saved && !formError && <p className="mt-2 text-sm text-emerald-400">Write-off recorded.</p>}

          <button
            onClick={() => void submit()}
            disabled={busy || !branchId.trim() || !variant}
            className="mt-3 rounded-md bg-red-800 px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-40"
          >
            {busy ? "Saving..." : "Record write-off"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Recent write-offs at this branch</h2>
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing written off yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((w) => (
                <div key={w.id} className="rounded-md bg-slate-900 p-2 text-sm">
                  <p>
                    {w.variant.product.name} ({w.variant.sku}) &times; {w.quantity} -{" "}
                    <span className="text-amber-400">{w.reason}</span>
                    {w.totalCost !== null && (
                      <span className="ml-2 font-mono text-slate-400">KES {Number(w.totalCost).toFixed(2)}</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(w.createdAt).toLocaleString()}
                    {w.batch ? ` · batch ${w.batch.batchNumber}` : ""}
                    {w.notes ? ` · ${w.notes}` : ""}
                  </p>
                  {w.ingredients.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Ingredients: {w.ingredients.map((i) => `${i.quantity} ${i.ingredientVariant.sku}`).join(", ")}
                    </p>
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
