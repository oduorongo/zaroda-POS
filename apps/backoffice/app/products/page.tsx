"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

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
  name: string | null;
  barcode: string | null;
  price: string;
  cost: string | null;
  quantityMode: QuantityMode;
}

interface Product {
  id: string;
  name: string;
  category: Category | null;
  taxClass: TaxClass | null;
  variants: Variant[];
  onlineVisible: boolean;
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
  const [variantName, setVariantName] = useState("");
  const [variantCost, setVariantCost] = useState("");
  const [variantBarcode, setVariantBarcode] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [variantMode, setVariantMode] = useState<QuantityMode>("COUNT");
  const [variantBusy, setVariantBusy] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);

  // Online listing controls only appear once the Online Shop add-on is on.
  // That endpoint is owner/manager-only, so other roles just don't see them.
  const [onlineShopActive, setOnlineShopActive] = useState(false);

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
      apiGet<{ addonActive: boolean }>("/online-store/me")
        .then((store) => setOnlineShopActive(store.addonActive))
        .catch(() => setOnlineShopActive(false));
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
    if (!isBackofficeRole(s.role)) {
      clearSession();
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
        name: variantName.trim() || undefined,
        price,
        cost: variantCost.trim() === "" ? undefined : Number(variantCost),
        barcode: variantBarcode.trim() || undefined,
        quantityMode: variantMode,
      });
      setVariantForProductId(null);
      setVariantSku("");
      setVariantPrice("");
      setVariantName("");
      setVariantCost("");
      setVariantBarcode("");
      setVariantMode("COUNT");
      await load();
    } catch (err) {
      setVariantError(err instanceof ApiError ? err.message : "Could not create variant.");
    } finally {
      setVariantBusy(false);
    }
  }

  function startEdit(v: Variant) {
    setEditingVariantId(v.id);
    setEditName(v.name ?? "");
    setEditPrice(String(Number(v.price)));
    setEditCost(v.cost === null ? "" : String(Number(v.cost)));
    setEditBarcode(v.barcode ?? "");
    setEditError(null);
  }

  // Gives the option a barcode of the shop's own (for bread, a repacked bag... things with no printed code) and shows it.
  async function makeBarcode(productId: string, variantId: string) {
    setBarcodeBusy(true);
    setEditError(null);
    try {
      const made = await apiPost<Variant>(`/products/${productId}/variants/${variantId}/barcode`, {});
      setEditBarcode(made.barcode ?? "");
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not make a barcode.");
    } finally {
      setBarcodeBusy(false);
    }
  }

  async function saveEdit(productId: string, variantId: string) {
    const price = Number(editPrice);
    const cost = editCost.trim() === "" ? undefined : Number(editCost);
    if (!Number.isFinite(price) || price < 0 || (cost !== undefined && (!Number.isFinite(cost) || cost < 0))) {
      setEditError("Price and cost must be amounts in shillings.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await apiPatch(`/products/${productId}/variants/${variantId}`, { name: editName.trim(), price, barcode: editBarcode.trim(), ...(cost !== undefined ? { cost } : {}) });
      setEditingVariantId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not save that.");
    } finally {
      setEditBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-4 text-xl font-bold">Products</h1>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        <section className="mb-6 rounded-lg border border-border p-4">
          <h2 className="mb-3 font-semibold">New product</h2>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 rounded-md border border-border bg-surface p-2 text-sm"
            />
            <select
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              className="rounded-md border border-border bg-surface p-2 text-sm"
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
              className="rounded-md border border-border bg-surface p-2 text-sm"
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
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold hover:bg-primary-500 disabled:opacity-40"
            >
              {createBusy ? "Creating..." : "Create"}
            </button>
          </div>
          {createError && <p className="mt-2 text-sm text-red-400">{createError}</p>}
        </section>

        {loading && <p className="text-secondary-500">Loading...</p>}
        {!loading && sortedProducts.length === 0 && !error && <p className="text-secondary-500">No products yet.</p>}

        <div className="space-y-3">
          {sortedProducts.map((product) => (
            <div key={product.id} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{product.name}</p>
                  <p className="text-xs text-secondary-500">
                    {product.category?.name ?? "No category"} · {product.taxClass?.name ?? "No tax class"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {onlineShopActive && (
                    <Link
                      href={`/products/online/${product.id}`}
                      className={`rounded-md px-3 py-1.5 text-sm ${
                        product.onlineVisible ? "bg-success-50 text-success-700 hover:opacity-80" : "bg-surface hover:bg-border"
                      }`}
                    >
                      {product.onlineVisible ? "Online ✓" : "Sell online"}
                    </Link>
                  )}
                  <button
                    onClick={() => setVariantForProductId(variantForProductId === product.id ? null : product.id)}
                    className="rounded-md bg-surface px-3 py-1.5 text-sm hover:bg-border"
                  >
                    + Variant
                  </button>
                </div>
              </div>

              {product.variants.length > 0 && (
                <table className="mt-3 w-full text-left text-sm">
                  <tbody>
                    {product.variants.map((v) => (
                      <tr key={v.id} className="border-t border-border">
                        <td className="py-1.5">
                          {v.name ? (
                            <>
                              {v.name} <span className="text-xs text-secondary-500">({v.sku})</span>
                            </>
                          ) : (
                            v.sku
                          )}
                          {v.barcode && <span className="block font-mono text-xs text-secondary-500">barcode {v.barcode}</span>}
                          {v.cost === null && <span className="ml-2 text-xs text-warning-700" title="Without a cost, this product's profit cannot be worked out">no cost yet</span>}
                          {v.quantityMode === "WEIGHT" && (
                            <span className="ml-2 rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">
                              sold by weight
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          KES {Number(v.price).toFixed(2)}
                          {v.quantityMode === "WEIGHT" && <span className="text-secondary-500"> /unit</span>}
                          {v.cost !== null && <span className="block text-xs text-secondary-500">cost {Number(v.cost).toFixed(2)}</span>}
                        </td>
                        <td className="py-1.5 pl-3 text-right">
                          <button onClick={() => (editingVariantId === v.id ? setEditingVariantId(null) : startEdit(v))} className="mr-3 text-xs text-primary-400 hover:underline">
                            Edit
                          </button>
                          <Link href={`/products/recipe/${v.id}`} className="text-xs text-primary-400 hover:underline">
                            Recipe
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {product.variants.map((v) =>
                editingVariantId === v.id ? (
                  <div key={`edit-${v.id}`} className="mt-3 space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs text-secondary-500">Changing {v.name ?? v.sku} ({v.sku})</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-secondary-500">
                        Option name
                        <input
                          placeholder="e.g. Large loaf 800g"
                          value={editName}
                          maxLength={60}
                          onChange={(e) => setEditName(e.target.value)}
                          className="mt-1 block w-52 rounded-md border border-border bg-background p-2 text-sm text-foreground"
                        />
                      </label>
                      <label className="text-xs text-secondary-500">
                        Selling price (KES)
                        <input type="number" min={0} step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="mt-1 block w-28 rounded-md border border-border bg-background p-2 text-sm text-foreground" />
                      </label>
                      <label className="text-xs text-secondary-500">
                        Cost to you (KES)
                        <input type="number" min={0} step="0.01" placeholder="what it costs you" value={editCost} onChange={(e) => setEditCost(e.target.value)} className="mt-1 block w-32 rounded-md border border-border bg-background p-2 text-sm text-foreground" />
                      </label>
                      <button onClick={() => void saveEdit(product.id, v.id)} disabled={editBusy} className="rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-40">
                        {editBusy ? "Saving..." : "Save"}
                      </button>
                      <button onClick={() => setEditingVariantId(null)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface">
                        Cancel
                      </button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-secondary-500">
                        Barcode
                        <input
                          placeholder="scan it or type it"
                          value={editBarcode}
                          maxLength={60}
                          onChange={(e) => setEditBarcode(e.target.value)}
                          className="mt-1 block w-56 rounded-md border border-border bg-background p-2 font-mono text-sm text-foreground"
                        />
                      </label>
                      <button
                        onClick={() => void makeBarcode(product.id, v.id)}
                        disabled={barcodeBusy || Boolean(editBarcode.trim())}
                        title="For things with no barcode on them: we make one you can print on a label"
                        className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface disabled:opacity-40"
                      >
                        {barcodeBusy ? "Making..." : "Make a barcode"}
                      </button>
                    </div>
                    <p className="text-xs text-secondary-500">The cost is used for your profit. It also updates by itself when you enter the price paid while receiving stock.</p>
                    {editError && <p className="text-sm text-red-400">{editError}</p>}
                  </div>
                ) : null,
              )}

              {variantForProductId === product.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <input
                    placeholder="Option name (e.g. Large loaf 800g)"
                    value={variantName}
                    maxLength={60}
                    onChange={(e) => setVariantName(e.target.value)}
                    className="w-56 rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <input
                    placeholder="Product code (e.g. SODA-500)"
                    value={variantSku}
                    onChange={(e) => setVariantSku(e.target.value)}
                    className="rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Price"
                    value={variantPrice}
                    onChange={(e) => setVariantPrice(e.target.value)}
                    className="w-28 rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <input
                    placeholder="Barcode (scan or type)"
                    value={variantBarcode}
                    maxLength={60}
                    onChange={(e) => setVariantBarcode(e.target.value)}
                    className="w-48 rounded-md border border-border bg-background p-2 font-mono text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Cost to you"
                    title="What one unit costs you. Used for your profit; it updates itself when you enter the price paid on a delivery."
                    value={variantCost}
                    onChange={(e) => setVariantCost(e.target.value)}
                    className="w-28 rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <select
                    value={variantMode}
                    onChange={(e) => setVariantMode(e.target.value as QuantityMode)}
                    className="rounded-md border border-border bg-background p-2 text-sm"
                    title="Count: sold in whole units (each, pack, box). Weight: sold in fractional quantities (kg, litre) - price is per unit."
                  >
                    <option value="COUNT">Sold by count</option>
                    <option value="WEIGHT">Sold by weight/volume</option>
                  </select>
                  <button
                    onClick={() => void createVariant(product.id)}
                    disabled={variantBusy || !variantSku.trim() || !Number.isFinite(Number(variantPrice))}
                    className="rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold hover:bg-primary-500 disabled:opacity-40"
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
