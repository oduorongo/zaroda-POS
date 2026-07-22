"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPut, ApiError } from "../../../../lib/api";
import { getSession, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";

type QuantityMode = "COUNT" | "WEIGHT";

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

interface RecipeIngredient {
  id: string;
  quantity: string;
  ingredientVariant: Variant;
}

interface DraftLine {
  ingredientVariantId: string;
  label: string;
  quantityMode: QuantityMode;
  quantity: string;
}

export default function RecipeEditorPage() {
  const params = useParams<{ variantId: string }>();
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [dish, setDish] = useState<Variant | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [pickedIngredient, setPickedIngredient] = useState<Variant | null>(null);
  const [pickedQuantity, setPickedQuantity] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, params.variantId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [productResult, recipeResult] = await Promise.all([
        apiGet<Product[]>("/products"),
        apiGet<RecipeIngredient[]>(`/recipes/${params.variantId}`),
      ]);
      setProducts(productResult);
      const flat = productResult.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } })));
      setDish(flat.find((v) => v.id === params.variantId) ?? null);
      setLines(
        recipeResult.map((r) => ({
          ingredientVariantId: r.ingredientVariant.id,
          label: `${r.ingredientVariant.product.name} (${r.ingredientVariant.sku})`,
          quantityMode: r.ingredientVariant.quantityMode,
          quantity: r.quantity,
        })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this recipe.");
    } finally {
      setLoading(false);
    }
  }

  const searchOptions = useMemo(() => {
    const flat = products.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } })));
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return flat
      .filter((v) => v.id !== params.variantId)
      .filter((v) => !lines.some((l) => l.ingredientVariantId === v.id))
      .filter((v) => v.product.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term))
      .slice(0, 20);
  }, [products, search, lines, params.variantId]);

  function addLine() {
    const qty = Number(pickedQuantity);
    if (!pickedIngredient || !Number.isFinite(qty) || qty <= 0) return;
    if (pickedIngredient.quantityMode === "COUNT" && !Number.isInteger(qty)) return;
    setLines((prev) => [
      ...prev,
      {
        ingredientVariantId: pickedIngredient.id,
        label: `${pickedIngredient.product.name} (${pickedIngredient.sku})`,
        quantityMode: pickedIngredient.quantityMode,
        quantity: pickedQuantity,
      },
    ]);
    setPickedIngredient(null);
    setPickedQuantity("");
    setSearch("");
  }

  function removeLine(ingredientVariantId: string) {
    setLines((prev) => prev.filter((l) => l.ingredientVariantId !== ingredientVariantId));
  }

  async function save(nextLines: DraftLine[]) {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiPut(`/recipes/${params.variantId}`, {
        ingredients: nextLines.map((l) => ({ ingredientVariantId: l.ingredientVariantId, quantity: Number(l.quantity) })),
      });
      setLines(nextLines);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this recipe.");
    } finally {
      setSaving(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-2xl p-6">
        <button onClick={() => router.push("/products")} className="mb-4 text-blue-400 hover:underline">
          &larr; Products
        </button>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}

        {!loading && dish && (
          <>
            <h1 className="text-xl font-bold">
              {dish.product.name} <span className="text-slate-500">({dish.sku})</span>
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {lines.length === 0
                ? "No recipe set - this is a plain stocked item: it's received and its own stock decrements on sale, same as any other product."
                : "Recipe set - selling this item decrements the ingredients below instead of its own stock. Nothing ever needs to be \"received\" for this item itself."}
            </p>

            <div className="mt-6 rounded-lg border border-slate-800 p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-300">Ingredients</h2>
              {lines.length === 0 ? (
                <p className="text-sm text-slate-500">None yet.</p>
              ) : (
                <div className="space-y-2">
                  {lines.map((l) => (
                    <div key={l.ingredientVariantId} className="flex items-center justify-between rounded-md bg-slate-800/60 px-3 py-2 text-sm">
                      <span>{l.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-400">
                          {l.quantity} {l.quantityMode === "WEIGHT" ? "(wt)" : ""}
                        </span>
                        <button onClick={() => removeLine(l.ingredientVariantId)} className="text-xs text-red-400 hover:text-red-300">
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 border-t border-slate-800 pt-4">
                <label className="block text-xs text-slate-400">Add ingredient</label>
                <input
                  placeholder="Search by product name or SKU"
                  value={pickedIngredient ? `${pickedIngredient.product.name} (${pickedIngredient.sku})` : search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPickedIngredient(null);
                  }}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
                {!pickedIngredient && search.trim() && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-700 bg-slate-900">
                    {searchOptions.length === 0 ? (
                      <p className="p-2 text-sm text-slate-500">No matching products.</p>
                    ) : (
                      searchOptions.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => {
                            setPickedIngredient(v);
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
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={pickedIngredient?.quantityMode === "WEIGHT" ? 0.001 : 1}
                    step={pickedIngredient?.quantityMode === "WEIGHT" ? "0.001" : "1"}
                    placeholder={`Quantity per 1 ${dish.sku} sold`}
                    value={pickedQuantity}
                    onChange={(e) => setPickedQuantity(e.target.value)}
                    className="flex-1 rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  />
                  <button
                    onClick={addLine}
                    disabled={!pickedIngredient || !Number.isFinite(Number(pickedQuantity)) || Number(pickedQuantity) <= 0}
                    className="rounded-md bg-slate-700 px-3 py-2 text-sm font-semibold hover:bg-slate-600 disabled:opacity-40"
                  >
                    + Add
                  </button>
                </div>
              </div>
            </div>

            {saveError && <p className="mt-4 text-sm text-red-400">{saveError}</p>}
            {saved && !saveError && <p className="mt-4 text-sm text-emerald-400">Recipe saved.</p>}

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => void save(lines)}
                disabled={saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save recipe"}
              </button>
              {lines.length > 0 && (
                <button
                  onClick={() => void save([])}
                  disabled={saving}
                  className="rounded-md bg-red-900 px-4 py-2 text-sm hover:bg-red-800 disabled:opacity-40"
                >
                  Clear recipe (revert to plain stocked item)
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
