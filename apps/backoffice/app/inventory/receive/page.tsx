"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";

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

interface InventoryTransaction {
  id: string;
  type: string;
  quantityDelta: number;
  createdAt: string;
  variant: Variant;
}

interface ReceiveLine {
  key: string;
  variantId: string;
  label: string;
  quantity: number;
  batchNumber?: string;
  expiryDate?: string;
}

export default function ReceiveStockPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [recent, setRecent] = useState<InventoryTransaction[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [deliveryRef, setDeliveryRef] = useState("");
  const [search, setSearch] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [trackBatch, setTrackBatch] = useState(false);
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [lineError, setLineError] = useState<string | null>(null);

  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);

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
        setLoadError(err instanceof ApiError ? err.message : "Could not load products or branches.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!branchId.trim()) return;
    void loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function loadRecent() {
    try {
      const txns = await apiGet<InventoryTransaction[]>(`/inventory/transactions?branchId=${branchId}`);
      setRecent(txns.filter((t) => t.type === "ADJUSTMENT" && t.quantityDelta > 0).slice(0, 10));
    } catch {
      // Non-critical - the receiving form still works without the recent log.
    }
  }

  const variantOptions = useMemo(() => {
    const flat = products.flatMap((p) =>
      p.variants.map((v) => ({ ...v, product: { name: p.name } })),
    );
    const term = search.trim().toLowerCase();
    if (!term) return flat.slice(0, 25);
    return flat
      .filter((v) => v.product.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term))
      .slice(0, 25);
  }, [products, search]);

  const selectedVariant = useMemo(
    () => variantOptions.find((v) => v.id === selectedVariantId) ||
      products.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } }))).find((v) => v.id === selectedVariantId),
    [variantOptions, products, selectedVariantId],
  );

  function addLine() {
    setLineError(null);
    const qty = Number(quantity);
    if (!selectedVariantId) {
      setLineError("Pick a product first.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setLineError("Quantity must be a positive number.");
      return;
    }
    if (selectedVariant?.quantityMode === "COUNT" && !Number.isInteger(qty)) {
      setLineError("This product is sold by count - quantity must be a whole number.");
      return;
    }
    if (trackBatch && !batchNumber.trim()) {
      setLineError("Batch number is required when tracking a batch.");
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random()}`,
        variantId: selectedVariantId,
        label: selectedVariant ? `${selectedVariant.product.name} (${selectedVariant.sku})` : selectedVariantId,
        quantity: qty,
        batchNumber: trackBatch ? batchNumber.trim() : undefined,
        expiryDate: trackBatch && expiryDate ? expiryDate : undefined,
      },
    ]);
    setSearch("");
    setSelectedVariantId("");
    setQuantity("");
    setTrackBatch(false);
    setBatchNumber("");
    setExpiryDate("");
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const totalUnits = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines]);

  async function submitAll() {
    if (lines.length === 0 || !branchId.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    let done = 0;
    const remaining = [...lines];
    try {
      while (remaining.length > 0) {
        const line = remaining[0];
        if (line.batchNumber) {
          await apiPost("/inventory/batches", {
            variantId: line.variantId,
            branchId,
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate || undefined,
            quantityReceived: line.quantity,
          });
        } else {
          await apiPost("/inventory/transactions", {
            branchId,
            variantId: line.variantId,
            type: "ADJUSTMENT",
            quantityDelta: line.quantity,
            referenceId: deliveryRef.trim() || undefined,
          });
        }
        remaining.shift();
        done += 1;
        setLines([...remaining]);
      }
      setSuccessCount(done);
      setDeliveryRef("");
      await loadRecent();
    } catch (err) {
      setSubmitError(
        (err instanceof ApiError ? err.message : "Could not record the delivery.") +
          ` (${done} of ${done + remaining.length} line(s) saved; the rest are still listed below to retry.)`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Receive stock</h1>
          <Link href="/inventory" className="text-sm text-slate-400 hover:text-slate-200">
            &larr; Back to inventory
          </Link>
        </div>

        {loadError && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{loadError}</p>}

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-slate-400">Branch receiving the stock</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
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
            <label className="block text-xs text-slate-400">Delivery reference (optional)</label>
            <input
              placeholder="e.g. supplier invoice # - applies to non-batch lines"
              value={deliveryRef}
              onChange={(e) => setDeliveryRef(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Add item</h2>

          <label className="block text-xs text-slate-400">Product</label>
          <input
            placeholder="Search by product name or SKU"
            value={selectedVariant ? `${selectedVariant.product.name} (${selectedVariant.sku})` : search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedVariantId("");
            }}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
          />
          {!selectedVariantId && search.trim() && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-700 bg-slate-900">
              {variantOptions.length === 0 ? (
                <p className="p-2 text-sm text-slate-500">No matching products.</p>
              ) : (
                variantOptions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedVariantId(v.id);
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

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-slate-400">
                Quantity received{selectedVariant?.quantityMode === "WEIGHT" ? " (e.g. kg)" : ""}
              </label>
              <input
                type="number"
                min={selectedVariant?.quantityMode === "WEIGHT" ? 0.001 : 1}
                step={selectedVariant?.quantityMode === "WEIGHT" ? "0.001" : "1"}
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-28 rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={trackBatch} onChange={(e) => setTrackBatch(e.target.checked)} />
              Track batch / expiry
            </label>
            {trackBatch && (
              <>
                <div>
                  <label className="block text-xs text-slate-400">Batch number</label>
                  <input
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    className="mt-1 w-32 rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400">Expiry date (optional)</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="mt-1 rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  />
                </div>
              </>
            )}
            <button
              onClick={addLine}
              className="rounded-md bg-slate-700 px-3 py-2 text-sm font-semibold hover:bg-slate-600"
            >
              + Add to delivery
            </button>
          </div>
          {lineError && <p className="mt-2 text-sm text-red-400">{lineError}</p>}
        </div>

        <div className="mb-4 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            This delivery {lines.length > 0 && `(${lines.length} line(s), ${totalUnits} unit(s))`}
          </h2>
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">No items added yet.</p>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.key} className="flex items-center justify-between rounded-md bg-slate-800/60 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{l.label}</span>{" "}
                    <span className="font-mono text-slate-400">+{l.quantity}</span>
                    {l.batchNumber && (
                      <span className="ml-2 text-xs text-slate-500">
                        batch {l.batchNumber}
                        {l.expiryDate ? ` · exp ${l.expiryDate}` : ""}
                      </span>
                    )}
                  </div>
                  <button onClick={() => removeLine(l.key)} className="text-xs text-red-400 hover:text-red-300">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => void submitAll()}
            disabled={submitting || lines.length === 0 || !branchId.trim()}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            {submitting ? "Saving..." : `Receive delivery (${lines.length})`}
          </button>
          {submitError && <p className="mt-2 text-sm text-red-400">{submitError}</p>}
          {successCount > 0 && lines.length === 0 && !submitError && (
            <p className="mt-2 text-sm text-emerald-400">Received {successCount} line(s) into stock.</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Recently received at this branch</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing received recently.</p>
          ) : (
            <div className="space-y-1">
              {recent.map((t) => (
                <p key={t.id} className="text-sm text-slate-400">
                  {t.variant.product.name} ({t.variant.sku}){" "}
                  <span className="font-mono text-emerald-400">+{t.quantityDelta}</span> ·{" "}
                  {new Date(t.createdAt).toLocaleString()}
                </p>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
