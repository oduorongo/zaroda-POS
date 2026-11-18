"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPut, ApiError } from "../../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";
import { variantLabel, variantTitleOf } from "../../../../lib/variant-label";

type QuantityMode = "COUNT" | "WEIGHT";

interface Variant {
  id: string;
  sku: string;
  name?: string | null;
  quantityMode: QuantityMode;
  product: { name: string };
  madeAhead?: boolean;
  tailorRate?: string | number | null;
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
  const [madeAhead, setMadeAhead] = useState(false);
  const [tailorRate, setTailorRate] = useState("");

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
      const found = flat.find((v) => v.id === params.variantId) ?? null;
      setDish(found);
      setMadeAhead(!!found?.madeAhead);
      setTailorRate(found?.tailorRate === null || found?.tailorRate === undefined ? "" : String(Number(found.tailorRate)));
      setLines(
        recipeResult.map((r) => ({
          ingredientVariantId: r.ingredientVariant.id,
          label: variantLabel(r.ingredientVariant.product.name, r.ingredientVariant),
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
      .filter((v) => v.product.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term) || (v.name ?? "").toLowerCase().includes(term))
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
        label: variantLabel(pickedIngredient.product.name, pickedIngredient),
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

  const uniforms = session?.industryType === "UNIFORM_MAKER";

  async function save(nextLines: DraftLine[]) {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiPut(`/recipes/${params.variantId}`, {
        ingredients: nextLines.map((l) => ({ ingredientVariantId: l.ingredientVariantId, quantity: Number(l.quantity) })),
        madeAhead,
        ...(uniforms ? { tailorRate: tailorRate.trim() === "" ? null : Number(tailorRate) } : {}),
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
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-2xl p-6">
        <button onClick={() => router.push("/products")} className="mb-4 text-primary-400 hover:underline">
          &larr; Products
        </button>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-secondary-500">Loading...</p>}

        {!loading && dish && (
          <>
            <h1 className="text-xl font-bold">
              {variantTitleOf(dish.product.name, dish)} <span className="text-secondary-500">({dish.sku})</span>
            </h1>
            <p className="mt-1 text-sm text-secondary-500">
              {lines.length === 0
                ? "No recipe set - this is a plain stocked item: it's received and its own stock decrements on sale, same as any other product."
                : madeAhead
                  ? "Made in advance - the list below is what making ONE uses (by production or a tailor). Selling it takes the finished item from stock."
                  : "Made when sold - selling this item takes the items below from stock instead of its own stock (a dish, or a uniform set made of pieces)."}
            </p>

            <div className="mt-4 space-y-2 rounded-lg border border-border p-4 text-sm">
              <h2 className="font-semibold text-secondary-600">How this item is made</h2>
              <label className="flex items-start gap-2">
                <input type="radio" name="made" checked={!madeAhead} onChange={() => setMadeAhead(false)} className="mt-1" />
                <span>
                  <strong>Made when sold</strong>: a restaurant dish, or a <strong>uniform set</strong>. List the pieces in the set (e.g. 2 x Shirt size 12, 1 x Shorts size 12); selling or delivering one set takes those pieces out of stock.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="made" checked={madeAhead} onChange={() => setMadeAhead(true)} className="mt-1" />
                <span>
                  <strong>Made in advance and kept in stock</strong>: a uniform piece your tailors sew, or bread from production. List the materials ONE piece uses (e.g. 1.2 metres of fabric, 7 buttons); making it uses them, selling it takes the finished piece.
                </span>
              </label>
              {uniforms && madeAhead && (
                <label className="block pt-2">
                  Tailor&apos;s pay per piece (KES)
                  <input type="number" min={0} step="0.01" value={tailorRate} onChange={(e) => setTailorRate(e.target.value)} placeholder="e.g. 80" className="mt-1 block w-40 rounded-md border border-border bg-background p-2" />
                  <span className="mt-1 block text-xs text-secondary-500">The usual rate for this piece and size; you can change it on each tailoring job.</span>
                </label>
              )}
              <p className="text-xs text-secondary-500">Press <strong>Save recipe</strong> below to keep this choice.</p>
            </div>

            <div className="mt-6 rounded-lg border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold text-secondary-600">Ingredients</h2>
              {lines.length === 0 ? (
                <p className="text-sm text-secondary-500">None yet.</p>
              ) : (
                <div className="space-y-2">
                  {lines.map((l) => (
                    <div key={l.ingredientVariantId} className="flex items-center justify-between rounded-md bg-surface/60 px-3 py-2 text-sm">
                      <span>{l.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-secondary-500">
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

              <div className="mt-4 border-t border-border pt-4">
                <label className="block text-xs text-secondary-500">Add ingredient</label>
                <input
                  placeholder="Search by product name or code"
                  value={pickedIngredient ? variantLabel(pickedIngredient.product.name, pickedIngredient) : search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPickedIngredient(null);
                  }}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
                />
                {!pickedIngredient && search.trim() && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-background">
                    {searchOptions.length === 0 ? (
                      <p className="p-2 text-sm text-secondary-500">No matching products.</p>
                    ) : (
                      searchOptions.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => {
                            setPickedIngredient(v);
                            setSearch("");
                          }}
                          className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface"
                        >
                          {variantTitleOf(v.product.name, v)} <span className="text-secondary-500">({v.sku})</span>
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
                    placeholder={`Quantity per 1 ${dish.name?.trim() || dish.sku} sold`}
                    value={pickedQuantity}
                    onChange={(e) => setPickedQuantity(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <button
                    onClick={addLine}
                    disabled={!pickedIngredient || !Number.isFinite(Number(pickedQuantity)) || Number(pickedQuantity) <= 0}
                    className="rounded-md bg-border px-3 py-2 text-sm font-semibold hover:bg-secondary-500 disabled:opacity-40"
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
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold hover:bg-primary-500 disabled:opacity-40"
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
