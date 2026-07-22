"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearSession,
  db,
  getActiveSession,
  getDeviceConfig,
  type CachedOrgUser,
  type CachedVariant,
  type CashierSession,
  type DeviceConfig,
  type OutboxDiscount,
} from "../../lib/db";
import { apiGet, apiPost, ApiError, OfflineError } from "../../lib/api";
import { useSyncEngine } from "../../hooks/use-sync-engine";

interface CartEntry {
  variant: CachedVariant;
  quantity: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  loyaltyPoints: number;
}

interface Batch {
  id: string;
  variantId: string;
  batchNumber: string;
  expiryDate: string | null;
}

// Roles allowed to approve a discount server-side (SalesService's
// SUPERVISOR_OR_ABOVE check) - mirrored here only to filter who shows up
// as a candidate approver. The server independently re-verifies the
// chosen approver's role against the database; this list is a UX
// convenience, never the actual authorization boundary.
const APPROVER_ROLES = ["SUPERVISOR", "MANAGER", "OWNER"];

// 1 loyalty point = KES 1 off (SalesService.LOYALTY_REDEEM_VALUE) - no
// endpoint exposes this rate, so it's mirrored here for the redemption
// preview only. The server computes and enforces the real value.
const LOYALTY_REDEEM_VALUE = 1;

export default function PosPage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [orgUsers, setOrgUsers] = useState<CachedOrgUser[]>([]);
  const [variants, setVariants] = useState<CachedVariant[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [tendered, setTendered] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [redeemPoints, setRedeemPoints] = useState("");

  const [discount, setDiscount] = useState<OutboxDiscount | null>(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [discountApproverId, setDiscountApproverId] = useState("");

  // Pharmacy-only: a controlled-substance line is rejected by POST
  // /pharmacy/sales with a 400 naming the products, not caught client-
  // side ahead of time (no bulk "which of these variants are flagged"
  // endpoint exists yet - see PharmacyProductFlagsService, only a
  // per-product lookup does). pendingClientId keeps the same idempotency
  // key across the reject-then-retry-with-prescription round trip.
  const [prescriptionModalOpen, setPrescriptionModalOpen] = useState(false);
  const [prescriptionMessage, setPrescriptionMessage] = useState("");
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);
  const [prescriptionNumber, setPrescriptionNumber] = useState("");
  const [prescriberName, setPrescriberName] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [pharmacyBusy, setPharmacyBusy] = useState(false);
  const [pharmacyError, setPharmacyError] = useState<string | null>(null);

  // Pharmacy-only batch/expiry picking per cart line - optional
  // (SaleLineItemInputDto.batchId), and only meaningful when the org
  // actually tracks batches for a variant. Fetched lazily per variant
  // (no bulk "batches for these N variants" endpoint exists, only
  // GET /inventory/batches?variantId=) and cached so re-expanding a line
  // doesn't refetch. An expired batch isn't filtered out here - the
  // pharmacy inventory.beforeDecrement hook is the actual enforcement
  // boundary; showing it (visibly flagged) and letting the server reject
  // it is more honest than silently hiding it as if it never existed.
  const [lineBatches, setLineBatches] = useState<Map<string, string>>(new Map());
  const [batchOptions, setBatchOptions] = useState<Map<string, Batch[]>>(new Map());
  const [batchesLoading, setBatchesLoading] = useState<Set<string>>(new Set());

  const sync = useSyncEngine();

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) {
        router.replace("/setup");
        return;
      }
      const activeSession = await getActiveSession();
      if (!activeSession) {
        router.replace("/login");
        return;
      }
      setDevice(config);
      setSession(activeSession);
      setVariants(await db.variants.toArray());
      setOrgUsers(await db.orgUsers.toArray());
    })();
  }, [router]);

  const approvers = useMemo(
    () => orgUsers.filter((u) => APPROVER_ROLES.includes(u.role)),
    [orgUsers],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter(
      (v) => v.productName.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q) || v.barcode?.includes(q),
    );
  }, [variants, search]);

  const cartEntries: CartEntry[] = useMemo(
    () =>
      Array.from(cart.entries())
        .map(([variantId, quantity]) => {
          const variant = variants.find((v) => v.id === variantId);
          return variant ? { variant, quantity } : null;
        })
        .filter((entry): entry is CartEntry => entry !== null),
    [cart, variants],
  );

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const { variant, quantity } of cartEntries) {
      const lineSubtotal = variant.price * quantity;
      subtotal += lineSubtotal;
      tax += lineSubtotal * variant.taxRate;
    }
    const preDiscountTotal = subtotal + tax;

    let discountAmount = 0;
    if (discount) {
      discountAmount =
        discount.type === "PERCENT" ? preDiscountTotal * (discount.value / 100) : discount.value;
      discountAmount = Math.min(discountAmount, preDiscountTotal);
    }

    const points = Number(redeemPoints);
    const maxRedeemable = customer ? customer.loyaltyPoints : 0;
    const redemptionValue =
      Number.isFinite(points) && points > 0
        ? Math.min(points, maxRedeemable) * LOYALTY_REDEEM_VALUE
        : 0;

    const total = Math.max(0, preDiscountTotal - discountAmount - redemptionValue);
    return { subtotal, tax, discountAmount, redemptionValue, total };
  }, [cartEntries, discount, redeemPoints, customer]);

  function addToCart(variant: CachedVariant) {
    setCart((prev) => {
      const next = new Map(prev);
      // WEIGHT items don't have a natural "+1" - default to 1 (unit of the
      // variant's own price basis, e.g. 1kg) and let the cart line's
      // decimal input be corrected to the actual weighed amount.
      next.set(variant.id, (next.get(variant.id) ?? 0) + 1);
      return next;
    });
  }

  function setQuantity(variantId: string, quantity: number) {
    setCart((prev) => {
      const next = new Map(prev);
      if (!(quantity > 0)) next.delete(variantId);
      else next.set(variantId, quantity);
      return next;
    });
    if (quantity <= 0) {
      setLineBatches((prev) => {
        if (!prev.has(variantId)) return prev;
        const next = new Map(prev);
        next.delete(variantId);
        return next;
      });
    }
  }

  async function loadBatchesFor(variantId: string) {
    if (!session || batchOptions.has(variantId) || batchesLoading.has(variantId)) return;
    setBatchesLoading((prev) => new Set(prev).add(variantId));
    try {
      const batches = await apiGet<Batch[]>(`/inventory/batches?variantId=${variantId}`, session.accessToken);
      setBatchOptions((prev) => new Map(prev).set(variantId, batches));
    } catch {
      // Leave unset - the batch selector just falls back to "no batches
      // found" rather than blocking the sale; a batch is optional.
    } finally {
      setBatchesLoading((prev) => {
        const next = new Set(prev);
        next.delete(variantId);
        return next;
      });
    }
  }

  function setLineBatch(variantId: string, batchId: string) {
    setLineBatches((prev) => {
      const next = new Map(prev);
      if (batchId) next.set(variantId, batchId);
      else next.delete(variantId);
      return next;
    });
  }

  async function completeSale() {
    if (!device || !session || cartEntries.length === 0) return;
    const amount = Number(tendered);
    if (!Number.isFinite(amount) || amount < totals.total - 0.01) return;

    if (device.industryType === "PHARMACY") {
      await submitPharmacySale(crypto.randomUUID(), amount, undefined);
      return;
    }

    const points = Number(redeemPoints);
    const redeemAmount = customer && Number.isFinite(points) && points > 0 ? Math.min(points, customer.loyaltyPoints) : null;

    await db.outbox.add({
      clientId: crypto.randomUUID(),
      branchId: device.branchId,
      terminalId: device.terminalId,
      cashierSessionId: session.cashierSessionId,
      lineItems: cartEntries.map((e) => ({ variantId: e.variant.id, quantity: e.quantity })),
      paymentAmount: totals.total,
      discount,
      customerId: customer?.id ?? null,
      redeemPoints: redeemAmount,
      createdAt: new Date().toISOString(),
      status: "pending",
      lastError: null,
      serverSaleId: null,
    });

    setCart(new Map());
    setCheckoutOpen(false);
    setTendered("");
    setCustomer(null);
    setRedeemPoints("");
    setDiscount(null);
    setToast(`Sale queued - change due: ${Math.max(0, amount - totals.total).toFixed(2)}`);
    setTimeout(() => setToast(null), 4000);
    void sync.runSync();
  }

  /**
   * Pharmacy sales bypass the outbox entirely (unlike the plain retail
   * flow above) - not for the restaurant module's "needs live
   * coordination" reason, but because the controlled-substance/
   * prescription check is a gating business rule that has to run before
   * the sale completes. Queuing it offline would mean a cashier could
   * physically hand over medication before the server ever validated the
   * prescription requirement - a worse compliance risk than a delayed
   * kitchen ticket.
   */
  async function submitPharmacySale(clientId: string, amount: number, prescription: { prescriptionNumber: string; prescriberName: string; issuedDate: string } | undefined) {
    if (!device || !session) return;
    setPharmacyBusy(true);
    setPharmacyError(null);
    try {
      await apiPost(
        "/pharmacy/sales",
        {
          clientId,
          branchId: device.branchId,
          terminalId: device.terminalId,
          cashierSessionId: session.cashierSessionId,
          lineItems: cartEntries.map((e) => ({
            variantId: e.variant.id,
            quantity: e.quantity,
            batchId: lineBatches.get(e.variant.id) || undefined,
          })),
          payments: [{ method: "CASH", amount: totals.total }],
          discount: discount ?? undefined,
          customerId: customer?.id ?? undefined,
          redeemPoints:
            customer && Number.isFinite(Number(redeemPoints)) && Number(redeemPoints) > 0
              ? Math.min(Number(redeemPoints), customer.loyaltyPoints)
              : undefined,
          prescription,
        },
        session.accessToken,
      );
      setCart(new Map());
      setLineBatches(new Map());
      setCheckoutOpen(false);
      setTendered("");
      setCustomer(null);
      setRedeemPoints("");
      setDiscount(null);
      setPrescriptionModalOpen(false);
      setPendingClientId(null);
      setPrescriptionNumber("");
      setPrescriberName("");
      setIssuedDate("");
      setToast(`Sale complete - change due: ${Math.max(0, amount - totals.total).toFixed(2)}`);
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      if (err instanceof OfflineError) {
        setPharmacyError("Offline - a pharmacy sale needs a connection to validate against prescription rules.");
        return;
      }
      if (err instanceof ApiError && err.status === 400 && /prescription/i.test(err.message)) {
        // Keep the same clientId across the retry - resubmitting with the
        // prescription attached must resolve to the same sale, not a
        // second one, if this ever raced with a retry from elsewhere.
        setPendingClientId(clientId);
        setPrescriptionMessage(err.message);
        setPrescriptionModalOpen(true);
        return;
      }
      setPharmacyError(err instanceof ApiError ? err.message : "Sale failed.");
    } finally {
      setPharmacyBusy(false);
    }
  }

  async function submitPrescriptionAndRetry() {
    if (!pendingClientId || !prescriptionNumber.trim() || !prescriberName.trim() || !issuedDate) return;
    const amount = Number(tendered);
    await submitPharmacySale(pendingClientId, amount, {
      prescriptionNumber: prescriptionNumber.trim(),
      prescriberName: prescriberName.trim(),
      issuedDate,
    });
  }

  async function switchCashier() {
    await clearSession();
    router.replace("/login");
  }

  async function searchCustomers(q: string) {
    setCustomerSearch(q);
    if (!session) return;
    setCustomerBusy(true);
    setCustomerError(null);
    try {
      const results = await apiGet<Customer[]>(`/customers?search=${encodeURIComponent(q)}`, session.accessToken);
      setCustomerResults(results);
    } catch (err) {
      setCustomerError(err instanceof OfflineError ? "Offline - customer lookup needs a connection." : "Search failed.");
      setCustomerResults([]);
    } finally {
      setCustomerBusy(false);
    }
  }

  async function createCustomer(name: string, phone: string) {
    if (!session || !name.trim()) return;
    setCustomerBusy(true);
    setCustomerError(null);
    try {
      const created = await apiPost<Customer>("/customers", { name: name.trim(), phone: phone.trim() || undefined }, session.accessToken);
      setCustomer(created);
      setCustomerModalOpen(false);
      setCustomerSearch("");
      setCustomerResults([]);
    } catch (err) {
      setCustomerError(err instanceof ApiError ? err.message : "Could not create customer.");
    } finally {
      setCustomerBusy(false);
    }
  }

  function applyDiscount() {
    const value = Number(discountValue);
    if (!Number.isFinite(value) || value <= 0 || !discountApproverId) return;
    setDiscount({ type: discountType, value, approvedById: discountApproverId });
    setDiscountModalOpen(false);
    setDiscountValue("");
    setDiscountApproverId("");
  }

  if (!device || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 p-3">
        <div>
          <p className="font-semibold">{session.cashierName}</p>
          <p className="text-xs text-slate-400">
            {sync.isSyncing ? "Syncing..." : sync.pendingCount > 0 ? `${sync.pendingCount} sale(s) pending sync` : "All synced"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {device.industryType === "RESTAURANT" && (
            <>
              <button onClick={() => router.push("/tables")} className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">
                Tables
              </button>
              <button onClick={() => router.push("/kds")} className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">
                Kitchen
              </button>
            </>
          )}
          {device.industryType === "SALON" && (
            <button onClick={() => router.push("/salon")} className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">
              Bookings
            </button>
          )}
          <button onClick={switchCashier} className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">
            Switch cashier
          </button>
        </div>
      </header>

      {toast && <div className="bg-green-800 p-2 text-center text-sm">{toast}</div>}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden p-3">
          <input
            className="mb-3 rounded-md border border-slate-700 bg-slate-800 p-2.5"
            placeholder="Search product, SKU, or scan barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {filtered.map((variant) => (
              <button
                key={variant.id}
                onClick={() => addToCart(variant)}
                className="flex flex-col items-start rounded-lg bg-slate-800 p-3 text-left hover:bg-slate-700"
              >
                <span className="font-medium">{variant.productName}</span>
                <span className="text-xs text-slate-400">{variant.sku}</span>
                <span className="mt-1 font-mono text-lg font-bold text-blue-400">KES {variant.price.toFixed(2)}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="col-span-full text-center text-slate-400">No matching products.</p>}
          </div>
        </div>

        <div className="flex w-80 flex-col border-l border-slate-800 p-3">
          <h2 className="font-semibold">Cart</h2>

          <div className="mt-2 space-y-2">
            {customer ? (
              <div className="flex items-center justify-between rounded-md bg-slate-800 p-2 text-sm">
                <div>
                  <p className="font-medium">{customer.name}</p>
                  <p className="text-xs text-slate-400">{customer.loyaltyPoints} pts</p>
                </div>
                <button onClick={() => { setCustomer(null); setRedeemPoints(""); }} className="text-xs text-red-400">
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCustomerModalOpen(true)}
                className="w-full rounded-md border border-dashed border-slate-700 p-2 text-sm text-slate-400 hover:border-slate-500"
              >
                + Attach customer
              </button>
            )}

            {customer && customer.loyaltyPoints > 0 && (
              <input
                type="number"
                min={0}
                max={customer.loyaltyPoints}
                placeholder={`Redeem points (max ${customer.loyaltyPoints})`}
                value={redeemPoints}
                onChange={(e) => setRedeemPoints(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
              />
            )}

            {discount ? (
              <div className="flex items-center justify-between rounded-md bg-slate-800 p-2 text-sm">
                <span>
                  Discount: {discount.type === "PERCENT" ? `${discount.value}%` : `KES ${discount.value.toFixed(2)}`}
                </span>
                <button onClick={() => setDiscount(null)} className="text-xs text-red-400">
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDiscountModalOpen(true)}
                disabled={approvers.length === 0}
                className="w-full rounded-md border border-dashed border-slate-700 p-2 text-sm text-slate-400 hover:border-slate-500 disabled:opacity-40"
              >
                + Apply discount
              </button>
            )}
          </div>

          <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
            {cartEntries.map(({ variant, quantity }) => (
              <div key={variant.id} className="rounded-md bg-slate-800 p-2">
                <p className="text-sm font-medium">{variant.productName}</p>
                <div className="mt-1 flex items-center justify-between">
                  {variant.quantityMode === "WEIGHT" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0.001}
                        step="0.001"
                        value={quantity}
                        onChange={(e) => setQuantity(variant.id, Number(e.target.value))}
                        className="w-20 rounded bg-slate-700 p-1 text-center"
                      />
                      <span className="text-xs text-slate-400">wt</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setQuantity(variant.id, quantity - 1)} className="h-7 w-7 rounded bg-slate-700">
                        -
                      </button>
                      <span className="w-6 text-center">{quantity}</span>
                      <button onClick={() => setQuantity(variant.id, quantity + 1)} className="h-7 w-7 rounded bg-slate-700">
                        +
                      </button>
                    </div>
                  )}
                  <span className="font-mono">KES {(variant.price * quantity).toFixed(2)}</span>
                </div>
                {device.industryType === "PHARMACY" && (
                  <select
                    value={lineBatches.get(variant.id) ?? ""}
                    onFocus={() => void loadBatchesFor(variant.id)}
                    onChange={(e) => setLineBatch(variant.id, e.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 p-1.5 text-xs"
                  >
                    <option value="">No batch selected</option>
                    {(batchOptions.get(variant.id) ?? []).map((b) => {
                      const expired = b.expiryDate ? new Date(b.expiryDate) < new Date() : false;
                      return (
                        <option key={b.id} value={b.id}>
                          {b.batchNumber}
                          {b.expiryDate ? ` - exp ${new Date(b.expiryDate).toLocaleDateString()}` : ""}
                          {expired ? " (EXPIRED)" : ""}
                        </option>
                      );
                    })}
                    {batchesLoading.has(variant.id) && <option disabled>Loading...</option>}
                  </select>
                )}
              </div>
            ))}
            {cartEntries.length === 0 && <p className="text-sm text-slate-500">Cart is empty.</p>}
          </div>

          <div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal</span>
              <span>KES {totals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Tax</span>
              <span>KES {totals.tax.toFixed(2)}</span>
            </div>
            {totals.discountAmount > 0 && (
              <div className="flex justify-between text-amber-400">
                <span>Discount</span>
                <span>-KES {totals.discountAmount.toFixed(2)}</span>
              </div>
            )}
            {totals.redemptionValue > 0 && (
              <div className="flex justify-between text-amber-400">
                <span>Points redeemed</span>
                <span>-KES {totals.redemptionValue.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>KES {totals.total.toFixed(2)}</span>
            </div>
          </div>

          <button
            onClick={() => setCheckoutOpen(true)}
            disabled={cartEntries.length === 0}
            className="mt-3 w-full rounded-md bg-blue-600 p-3 font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            Charge (Cash)
          </button>
        </div>
      </div>

      {checkoutOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-slate-800 p-6">
            <h2 className="text-xl font-bold">Cash payment</h2>
            <p className="mt-1 text-slate-400">Total due: KES {totals.total.toFixed(2)}</p>
            <input
              type="number"
              autoFocus
              className="mt-4 w-full rounded-md border border-slate-600 bg-slate-900 p-3 text-lg"
              placeholder="Amount tendered"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
            />
            {Number(tendered) >= totals.total && (
              <p className="mt-2 text-green-400">Change due: KES {(Number(tendered) - totals.total).toFixed(2)}</p>
            )}
            {pharmacyError && <p className="mt-2 text-sm text-red-400">{pharmacyError}</p>}
            <div className="mt-4 flex gap-3">
              <button onClick={() => setCheckoutOpen(false)} className="flex-1 rounded-md bg-slate-700 p-3">
                Cancel
              </button>
              <button
                onClick={completeSale}
                disabled={pharmacyBusy || !Number.isFinite(Number(tendered)) || Number(tendered) < totals.total - 0.01}
                className="flex-1 rounded-md bg-blue-600 p-3 font-semibold disabled:opacity-40"
              >
                {pharmacyBusy ? "..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {prescriptionModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-slate-800 p-6">
            <h2 className="text-xl font-bold">Prescription required</h2>
            <p className="mt-1 text-sm text-amber-400">{prescriptionMessage}</p>
            <input
              className="mt-4 w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              placeholder="Prescription number"
              value={prescriptionNumber}
              onChange={(e) => setPrescriptionNumber(e.target.value)}
            />
            <input
              className="mt-3 w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              placeholder="Prescriber name"
              value={prescriberName}
              onChange={(e) => setPrescriberName(e.target.value)}
            />
            <input
              type="date"
              className="mt-3 w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
            />
            {pharmacyError && <p className="mt-2 text-sm text-red-400">{pharmacyError}</p>}
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  setPrescriptionModalOpen(false);
                  setPendingClientId(null);
                  setPharmacyError(null);
                }}
                className="flex-1 rounded-md bg-slate-700 p-3"
              >
                Cancel sale
              </button>
              <button
                onClick={() => void submitPrescriptionAndRetry()}
                disabled={pharmacyBusy || !prescriptionNumber.trim() || !prescriberName.trim() || !issuedDate}
                className="flex-1 rounded-md bg-blue-600 p-3 font-semibold disabled:opacity-40"
              >
                {pharmacyBusy ? "..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {customerModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-slate-800 p-6">
            <h2 className="text-xl font-bold">Attach customer</h2>
            <input
              autoFocus
              className="mt-4 w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              placeholder="Search name or phone..."
              value={customerSearch}
              onChange={(e) => void searchCustomers(e.target.value)}
            />
            {customerError && <p className="mt-2 text-sm text-red-400">{customerError}</p>}
            <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
              {customerResults.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCustomer(c);
                    setCustomerModalOpen(false);
                    setCustomerSearch("");
                    setCustomerResults([]);
                  }}
                  className="flex w-full items-center justify-between rounded-md bg-slate-900 p-2 text-left hover:bg-slate-700"
                >
                  <span>{c.name}</span>
                  <span className="text-xs text-slate-400">{c.phone ?? "no phone"} · {c.loyaltyPoints} pts</span>
                </button>
              ))}
              {customerBusy && <p className="text-sm text-slate-400">Searching...</p>}
            </div>
            {customerSearch.trim().length > 0 && customerResults.length === 0 && !customerBusy && (
              <button
                onClick={() => void createCustomer(customerSearch, "")}
                className="mt-3 w-full rounded-md bg-blue-600 p-2 text-sm font-semibold"
              >
                + New customer &quot;{customerSearch.trim()}&quot;
              </button>
            )}
            <button
              onClick={() => {
                setCustomerModalOpen(false);
                setCustomerSearch("");
                setCustomerResults([]);
                setCustomerError(null);
              }}
              className="mt-4 w-full rounded-md bg-slate-700 p-3"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {discountModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-slate-800 p-6">
            <h2 className="text-xl font-bold">Apply discount</h2>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setDiscountType("PERCENT")}
                className={`flex-1 rounded-md p-2 ${discountType === "PERCENT" ? "bg-blue-600" : "bg-slate-700"}`}
              >
                Percent
              </button>
              <button
                onClick={() => setDiscountType("FIXED")}
                className={`flex-1 rounded-md p-2 ${discountType === "FIXED" ? "bg-blue-600" : "bg-slate-700"}`}
              >
                Fixed (KES)
              </button>
            </div>
            <input
              type="number"
              className="mt-3 w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              placeholder={discountType === "PERCENT" ? "e.g. 10" : "e.g. 200"}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
            <p className="mt-4 text-sm text-slate-400">Approved by (supervisor+):</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {approvers.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setDiscountApproverId(a.id)}
                  className={`w-full rounded-md p-2 text-left ${discountApproverId === a.id ? "bg-blue-600" : "bg-slate-900 hover:bg-slate-700"}`}
                >
                  {a.fullName} <span className="text-xs text-slate-400">({a.role})</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  setDiscountModalOpen(false);
                  setDiscountValue("");
                  setDiscountApproverId("");
                }}
                className="flex-1 rounded-md bg-slate-700 p-3"
              >
                Cancel
              </button>
              <button
                onClick={applyDiscount}
                disabled={!Number.isFinite(Number(discountValue)) || Number(discountValue) <= 0 || !discountApproverId}
                className="flex-1 rounded-md bg-blue-600 p-3 font-semibold disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
