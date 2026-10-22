"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { PageHeader } from "../../../components/page-header";
import { variantLabel } from "../../../lib/variant-label";
import { findByCode } from "../../../lib/barcode";
import { useScanner } from "../../../hooks/use-scanner";
import { BarcodeScanner } from "../../../components/barcode-scanner";

interface Variant {
  id: string;
  sku: string;
  name?: string | null;
  barcode?: string | null;
  quantityMode: "COUNT" | "WEIGHT";
  cost?: string | number | null;
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
  /** What was paid per unit (optional). */
  unitCost?: number;
  /** Arrived broken, expired or wrong: not put into stock, written on the receipt. */
  damaged?: number;
}

interface Supplier {
  id: string;
  name: string;
}

interface Warning {
  variantId: string;
  sku: string;
  name: string;
  price: number;
  cost: number;
  marginPercent: number;
  previousCost: number | null;
  reason: "BELOW_MINIMUM" | "LOSS" | "COST_UP";
}

interface ReceiptResult {
  receipt: { id: string; receiptNumber: string };
  warnings: Warning[];
  bill: { id: string; billNumber: string; total: number; dueDate: string } | null;
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
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [makeBill, setMakeBill] = useState(false);
  const [billNumber, setBillNumber] = useState("");
  const [damaged, setDamaged] = useState("");
  const [result, setResult] = useState<ReceiptResult | null>(null);
  const [search, setSearch] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [trackBatch, setTrackBatch] = useState(false);
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [lineError, setLineError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

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
    if (!isBackofficeRole(s.role)) {
      clearSession();
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
    apiGet<Supplier[]>("/suppliers").then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    if (!branchId.trim()) return;
    void loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function loadRecent() {
    try {
      const txns = await apiGet<InventoryTransaction[]>(`/inventory/transactions?branchId=${branchId}`);
      setRecent(txns.filter((t) => (t.type === "RECEIPT" || t.type === "ADJUSTMENT") && t.quantityDelta > 0).slice(0, 10));
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
      .filter((v) => v.product.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term) || (v.name ?? "").toLowerCase().includes(term))
      .slice(0, 25);
  }, [products, search]);

  // A scanned (or typed-and-Enter) barcode picks the product and puts the cursor in the quantity box, ready for the count.
  const everyVariant = useMemo(() => products.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } }))), [products]);
  function onScanned(code: string) {
    const match = findByCode(everyVariant, code);
    if (match) {
      setSelectedVariantId(match.id);
      setSearch("");
      setLineError(null);
      setScanNote(`Found: ${variantLabel(match.product.name, match)}`);
      setScanOpen(false);
    } else {
      setScanNote(`Nothing has the barcode ${code}. Add the barcode to the product first, or search by name.`);
    }
  }
  useScanner(onScanned, !scanOpen);
  useEffect(() => {
    if (selectedVariantId) quantityRef.current?.focus();
  }, [selectedVariantId]);

  const selectedVariant = useMemo(
    () => variantOptions.find((v) => v.id === selectedVariantId) ||
      products.flatMap((p) => p.variants.map((v) => ({ ...v, product: { name: p.name } }))).find((v) => v.id === selectedVariantId),
    [variantOptions, products, selectedVariantId],
  );

  function addLine() {
    setLineError(null);
    const qty = Number(quantity || 0);
    const bad = Number(damaged || 0);
    if (!selectedVariantId) {
      setLineError("Pick a product first.");
      return;
    }
    if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(bad) || bad < 0 || qty + bad <= 0) {
      setLineError("Enter the quantity received (or the quantity that was damaged).");
      return;
    }
    if (selectedVariant?.quantityMode === "COUNT" && (!Number.isInteger(qty) || !Number.isInteger(bad))) {
      setLineError("This product is sold by count - quantities must be whole numbers.");
      return;
    }
    if (trackBatch && !batchNumber.trim()) {
      setLineError("Batch number is required when tracking a batch.");
      return;
    }
    const paid = unitCost.trim() === "" ? undefined : Number(unitCost);
    if (paid !== undefined && (!Number.isFinite(paid) || paid < 0 || Math.round(paid * 100) !== paid * 100)) {
      setLineError("The price paid must be an amount in shillings, like 80 or 80.50.");
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random()}`,
        variantId: selectedVariantId,
        label: selectedVariant ? variantLabel(selectedVariant.product.name, selectedVariant) : selectedVariantId,
        quantity: qty,
        batchNumber: trackBatch ? batchNumber.trim() : undefined,
        expiryDate: trackBatch && expiryDate ? expiryDate : undefined,
        unitCost: paid,
        damaged: bad > 0 ? bad : undefined,
      },
    ]);
    setSearch("");
    setSelectedVariantId("");
    setQuantity("");
    setDamaged("");
    setUnitCost("");
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
    setResult(null);
    try {
      // One request: the whole delivery is received together or not at all, as one goods-received note.
      const r = await apiPost<ReceiptResult>("/goods-receipts", {
        branchId,
        supplierId: supplierId || undefined,
        deliveryNote: deliveryRef.trim() || undefined,
        bill: makeBill ? { billNumber: billNumber.trim() || undefined } : undefined,
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, damaged: l.damaged, unitCost: l.unitCost, batchNumber: l.batchNumber, expiryDate: l.expiryDate })),
      });
      setResult(r);
      setSuccessCount(lines.length);
      setLines([]);
      setDeliveryRef("");
      setBillNumber("");
      setMakeBill(false);
      await loadRecent();
    } catch (err) {
      setSubmitError((err instanceof ApiError ? err.message : "Could not record the delivery.") + " Nothing was saved - fix it and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Receive stock</h1>
          <Link href="/inventory" className="text-sm text-secondary-500 hover:text-secondary-600">
            &larr; Back to inventory
          </Link>
        </div>

        {loadError && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{loadError}</p>}

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-secondary-500">Branch receiving the stock</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
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
            <label className="block text-xs text-secondary-500">Supplier delivery note / invoice no. (optional)</label>
            <input
              placeholder="e.g. the number on the supplier's paper"
              value={deliveryRef}
              onChange={(e) => setDeliveryRef(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-4 space-y-2 rounded-lg border border-border p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-secondary-500">Supplier (optional)</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm">
                <option value="">No supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="mt-5 flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={!supplierId} checked={makeBill} onChange={(e) => setMakeBill(e.target.checked)} />
              Record what we now owe this supplier
            </label>
          </div>
          {makeBill && (
            <div>
              <label className="block text-xs text-secondary-500">Supplier invoice number (the delivery note number is used if empty)</label>
              <input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm sm:w-1/2" />
              <p className="mt-1 text-xs text-secondary-500">The bill is for the good stock only, at the prices you enter below (every line needs a price). It falls due after the supplier&apos;s payment terms.</p>
            </div>
          )}
        </div>

        <div className="mb-4 rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-secondary-600">Add item</h2>

          <label className="block text-xs text-secondary-500">Product</label>
          <input
            placeholder="Search by product name or code"
            value={selectedVariant ? variantLabel(selectedVariant.product.name, selectedVariant) : search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedVariantId("");
              setScanNote(null);
            }}
            onKeyDown={(e) => {
              // A scanner gun types the code and presses Enter.
              if (e.key === "Enter" && search.trim()) {
                e.preventDefault();
                if (findByCode(everyVariant, search)) onScanned(search.trim());
              }
            }}
            className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-secondary-500">
            <button type="button" onClick={() => setScanOpen(true)} className="rounded-md border border-border px-2 py-1 hover:bg-surface">
              Scan with the camera
            </button>
            <span>or scan with a scanner gun - no need to click anywhere first.</span>
          </div>
          {scanNote && <p className={`mt-1 text-sm ${scanNote.startsWith("Found") ? "text-emerald-500" : "text-amber-500"}`}>{scanNote}</p>}
          {scanOpen && <BarcodeScanner onDetected={onScanned} onClose={() => setScanOpen(false)} />}
          {!selectedVariantId && search.trim() && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background">
              {variantOptions.length === 0 ? (
                <p className="p-2 text-sm text-secondary-500">No matching products.</p>
              ) : (
                variantOptions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedVariantId(v.id);
                      setSearch("");
                    }}
                    className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface"
                  >
                    {v.name ? variantLabel(v.product.name, v) : v.product.name} <span className="text-secondary-500">({v.sku})</span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-secondary-500">
                Quantity received{selectedVariant?.quantityMode === "WEIGHT" ? " (e.g. kg)" : ""}
              </label>
              <input
                type="number"
                min={selectedVariant?.quantityMode === "WEIGHT" ? 0.001 : 1}
                step={selectedVariant?.quantityMode === "WEIGHT" ? "0.001" : "1"}
                placeholder="0"
                ref={quantityRef}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLine();
                  }
                }}
                className="mt-1 w-28 rounded-md border border-border bg-background p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-secondary-500">Damaged / rejected</label>
              <input type="number" min={0} step="any" placeholder="0" value={damaged} onChange={(e) => setDamaged(e.target.value)} className="mt-1 w-28 rounded-md border border-border bg-background p-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-secondary-500">
                Price paid per {selectedVariant?.quantityMode === "WEIGHT" ? "kg / litre" : "item"} (KES, optional)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder={selectedVariant?.cost != null ? `now ${Number(selectedVariant.cost)}` : "e.g. 80"}
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="mt-1 w-32 rounded-md border border-border bg-background p-2 text-sm"
              />
            </div>
            <label className="mb-2 flex items-center gap-2 text-sm text-secondary-500">
              <input type="checkbox" checked={trackBatch} onChange={(e) => setTrackBatch(e.target.checked)} />
              Track batch / expiry
            </label>
            {trackBatch && (
              <>
                <div>
                  <label className="block text-xs text-secondary-500">Batch number</label>
                  <input
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    className="mt-1 w-32 rounded-md border border-border bg-background p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-secondary-500">Expiry date (optional)</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="mt-1 rounded-md border border-border bg-background p-2 text-sm"
                  />
                </div>
              </>
            )}
            <button
              onClick={addLine}
              className="rounded-md bg-border px-3 py-2 text-sm font-semibold hover:bg-secondary-500"
            >
              + Add to delivery
            </button>
          </div>
          <p className="mt-2 text-xs text-secondary-500">
            Enter what you paid and the product&apos;s cost updates by itself - blended with the stock you already hold - so your profit report always uses a real, current cost. Leave it empty to keep the cost as it is.
          </p>
          {lineError && <p className="mt-2 text-sm text-red-400">{lineError}</p>}
        </div>

        <div className="mb-4 rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-secondary-600">
            This delivery {lines.length > 0 && `(${lines.length} line(s), ${totalUnits} unit(s))`}
          </h2>
          {lines.length === 0 ? (
            <p className="text-sm text-secondary-500">No items added yet.</p>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.key} className="flex items-center justify-between rounded-md bg-surface/60 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{l.label}</span>{" "}
                    <span className="font-mono text-secondary-500">+{l.quantity}</span>
                    {l.damaged ? <span className="ml-2 text-xs text-amber-500">{l.damaged} damaged (not added to stock)</span> : null}
                    {l.unitCost !== undefined && <span className="ml-2 text-xs text-secondary-500">at KES {l.unitCost.toLocaleString()} each</span>}
                    {l.batchNumber && (
                      <span className="ml-2 text-xs text-secondary-500">
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
            className="mt-4 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold hover:bg-primary-500 disabled:opacity-40"
          >
            {submitting ? "Saving..." : `Receive delivery (${lines.length})`}
          </button>
          {submitError && <p className="mt-2 text-sm text-red-400">{submitError}</p>}
          {result && lines.length === 0 && !submitError && (
            <div className="mt-2 space-y-2 text-sm">
              <p className="text-emerald-400">
                Received {successCount} line(s) into stock as{" "}
                <Link href={`/goods-receipts/${result.receipt.id}`} className="underline">
                  {result.receipt.receiptNumber}
                </Link>
                .{result.bill && ` A bill of KES ${result.bill.total.toLocaleString()} (invoice ${result.bill.billNumber}) is due ${result.bill.dueDate}.`}
              </p>
              {result.warnings.map((w) => (
                <p key={w.variantId} className="rounded-md bg-amber-950 p-2 text-amber-200">
                  {w.reason === "LOSS" ? "Selling at a loss: " : w.reason === "BELOW_MINIMUM" ? "Thin margin: " : "Cost went up: "}
                  {w.name} costs KES {w.cost.toLocaleString()} and sells for KES {w.price.toLocaleString()} ({w.marginPercent}% margin)
                  {w.previousCost !== null ? `, up from KES ${w.previousCost.toLocaleString()}` : ""}. Check its selling price on the Products screen.
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-secondary-600">Recently received at this branch</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-secondary-500">Nothing received recently.</p>
          ) : (
            <div className="space-y-1">
              {recent.map((t) => (
                <p key={t.id} className="text-sm text-secondary-500">
                  {variantLabel(t.variant.product.name, t.variant)}{" "}
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
