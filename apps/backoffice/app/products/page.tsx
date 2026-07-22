"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Category {
  id: string;
  name: string;
}

interface TaxClass {
  id: string;
  name: string;
  rate: string;
  isExempt: boolean;
}

type QuantityMode = "COUNT" | "WEIGHT";

interface Variant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  price: string;
  quantityMode: QuantityMode;
}

interface Product {
  id: string;
  name: string;
  category: Category | null;
  taxClass: TaxClass | null;
  variants: Variant[];
}

/**
 * Read/write catalog management - MANAGER/OWNER only server-side
 * (see products.controller.ts's @Roles()); reads are open to any
 * authenticated role, so a lower-privileged login can browse this page
 * but the create/save actions will 403 from the server, not just be
 * hidden client-side.
 */
export default function ProductsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [taxClasses, setTaxClasses] = useState<TaxClass[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newTaxClassId, setNewTaxClassId] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [variantForProductId, setVariantForProductId] = useState<string | null>(null);
  const [variantSku, setVariantSku] = useState("");
  const [variantPrice, setVariantPrice] = useState("");
  const [variantMode, setVariantMode] = useState<QuantityMode>("COUNT");
  const [variantBusy, setVariantBusy] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);

  async function load() {
    try {
      const [productsResult, categoriesResult, taxClassesResult] = await Promise.all([
        apiGet<Product[]>("/products"),
        apiGet<Category[]>("/categories"),
        apiGet<TaxClass[]>("/tax-classes"),
      ]);
      setProducts(productsResult);
      setCategories(categoriesResult);
      setTaxClasses(taxClassesResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the catalog.");
    } finally {
      setLoading(false);
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
  }, [router]);

  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);

  async function createProduct() {
    if (!newName.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await apiPost("/products", {
        name: newName.trim(),
        categoryId: newCategoryId || undefined,
        taxClassId: newTaxClassId || undefined,
      });
      setNewName("");
      setNewCategoryId("");
      setNewTaxClassId("");
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create product.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function createVariant(productId: string) {
    const price = Number(variantPrice);
    if (!variantSku.trim() || !Number.isFinite(price) || price < 0) return;
    setVariantBusy(true);
    setVariantError(null);
    try {
      await apiPost(`/products/${productId}/variants`, {
        sku: variantSku.trim(),
        price,
        quantityMode: variantMode,
      });
      setVariantForProductId(null);
      setVariantSku("");
      setVariantPrice("");
      setVariantMode("COUNT");
      await load();
    } catch (err) {
      setVariantError(err instanceof ApiError ? err.message : "Could not create variant.");
    } finally {
      setVariantBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-4 text-xl font-bold">Products</h1>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        <section className="mb-6 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">New product</h2>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
            />
            <select
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={newTaxClassId}
              onChange={(e) => setNewTaxClassId(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
            >
              <option value="">No tax class</option>
              {taxClasses.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({(Number(t.rate) * 100).toFixed(0)}%)
                </option>
              ))}
            </select>
            <button
              onClick={() => void createProduct()}
              disabled={createBusy || !newName.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
            >
              {createBusy ? "Creating..." : "Create"}
            </button>
          </div>
          {createError && <p className="mt-2 text-sm text-red-400">{createError}</p>}
        </section>

        {loading && <p className="text-slate-400">Loading...</p>}
        {!loading && sortedProducts.length === 0 && !error && <p className="text-slate-400">No products yet.</p>}

        <div className="space-y-3">
          {sortedProducts.map((product) => (
            <div key={product.id} className="rounded-lg border border-slate-800 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{product.name}</p>
                  <p className="text-xs text-slate-400">
                    {product.category?.name ?? "No category"} · {product.taxClass?.name ?? "No tax class"}
                  </p>
                </div>
                <button
                  onClick={() => setVariantForProductId(variantForProductId === product.id ? null : product.id)}
                  className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
                >
                  + Variant
                </button>
              </div>

              {product.variants.length > 0 && (
                <table className="mt-3 w-full text-left text-sm">
                  <tbody>
                    {product.variants.map((v) => (
                      <tr key={v.id} className="border-t border-slate-800">
                        <td className="py-1.5">
                          {v.sku}
                          {v.quantityMode === "WEIGHT" && (
                            <span className="ml-2 rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">
                              sold by weight
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          KES {Number(v.price).toFixed(2)}
                          {v.quantityMode === "WEIGHT" && <span className="text-slate-500"> /unit</span>}
                        </td>
                        <td className="py-1.5 pl-3 text-right">
                          <Link href={`/products/recipe/${v.id}`} className="text-xs text-blue-400 hover:underline">
                            Recipe
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {variantForProductId === product.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                  <input
                    placeholder="SKU"
                    value={variantSku}
                    onChange={(e) => setVariantSku(e.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Price"
                    value={variantPrice}
                    onChange={(e) => setVariantPrice(e.target.value)}
                    className="w-28 rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  />
                  <select
                    value={variantMode}
                    onChange={(e) => setVariantMode(e.target.value as QuantityMode)}
                    className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                    title="Count: sold in whole units (each, pack, box). Weight: sold in fractional quantities (kg, litre) - price is per unit."
                  >
                    <option value="COUNT">Sold by count</option>
                    <option value="WEIGHT">Sold by weight/volume</option>
                  </select>
                  <button
                    onClick={() => void createVariant(product.id)}
                    disabled={variantBusy || !variantSku.trim() || !Number.isFinite(Number(variantPrice))}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                  >
                    {variantBusy ? "Saving..." : "Save"}
                  </button>
                  {variantError && <p className="text-sm text-red-400">{variantError}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
