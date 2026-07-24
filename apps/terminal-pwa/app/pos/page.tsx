"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Button, Badge } from "@zaroda/ui";

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

type TenderMethod = "CASH" | "MPESA";
type MpesaStkStatus = "idle" | "sending" | "pending" | "success" | "failed";

interface ReceiptData {
  clientId: string;
  createdAt: string;
  cashierName: string;
  branchName: string;
  items: { name: string; sku: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  tax: number;
  discountAmount: number;
  redemptionValue: number;
  total: number;
  tenderMethod: TenderMethod;
  changeDue: number | null;
  mpesaReceiptNumber: string | null;
}

interface MpesaStatusResponse {
  status: "PENDING" | "SUCCESS" | "FAILED";
  checkoutRequestId: string;
  mpesaReceiptNumber: string | null;
  resultDesc: string | null;
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

// How long to keep polling GET /payments/mpesa/status before giving up and
// letting the cashier retry - the customer might just be slow to unlock
// their phone. 60s @ 3s intervals is generous without leaving the register
// hung indefinitely on a prompt that was never going to be approved.
const MPESA_POLL_INTERVAL_MS = 3000;
const MPESA_POLL_TIMEOUT_MS = 60_000;

/** 07XXXXXXXX / 7XXXXXXXX / 2547XXXXXXXX / +2547XXXXXXXX -> 2547XXXXXXXX (what Daraja requires). */
function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

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
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

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

  // Tender selection (Cash / M-Pesa) - Card and Split are shown but
  // disabled: no card processor is wired (payment-processor.interface.ts
  // has no CardPaymentProcessor yet), and split-tender needs a
  // multi-payment UI that's a natural follow-up, not built yet. Neither is
  // faked as working.
  const [tenderMethod, setTenderMethod] = useState<TenderMethod>("CASH");
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [mpesaStatus, setMpesaStatus] = useState<MpesaStkStatus>("idle");
  const [mpesaError, setMpesaError] = useState<string | null>(null);
  const saleClientIdRef = useRef<string>(crypto.randomUUID());
  const mpesaPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mpesaPollDeadline = useRef<number>(0);

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

  useEffect(() => {
    return () => {
      if (mpesaPollTimer.current) clearInterval(mpesaPollTimer.current);
    };
  }, []);

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

  function openCheckout() {
    saleClientIdRef.current = crypto.randomUUID();
    setTenderMethod("CASH");
    setTendered("");
    setMpesaPhone(customer?.phone ?? "");
    setMpesaStatus("idle");
    setMpesaError(null);
    setCheckoutOpen(true);
  }

  function closeCheckout() {
    if (mpesaPollTimer.current) clearInterval(mpesaPollTimer.current);
    setCheckoutOpen(false);
  }

  function buildReceipt(
    tenderMethod: TenderMethod,
    changeDue: number | null,
    mpesaReceiptNumber: string | null,
    clientId: string = saleClientIdRef.current,
  ): ReceiptData {
    return {
      clientId,
      createdAt: new Date().toISOString(),
      cashierName: session!.cashierName,
      branchName: device!.branchName,
      items: cartEntries.map(({ variant, quantity }) => ({
        name: variant.productName,
        sku: variant.sku,
        quantity,
        unitPrice: variant.price,
        lineTotal: variant.price * quantity,
      })),
      subtotal: totals.subtotal,
      tax: totals.tax,
      discountAmount: totals.discountAmount,
      redemptionValue: totals.redemptionValue,
      total: totals.total,
      tenderMethod,
      changeDue,
      mpesaReceiptNumber,
    };
  }

  function resetSaleState() {
    setCart(new Map());
    setLineBatches(new Map());
    setCheckoutOpen(false);
    setTendered("");
    setCustomer(null);
    setRedeemPoints("");
    setDiscount(null);
    setTenderMethod("CASH");
    setMpesaStatus("idle");
    setMpesaError(null);
  }

  async function completeCashSale() {
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
      clientId: saleClientIdRef.current,
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

    const changeDue = Math.max(0, amount - totals.total);
    setReceipt(buildReceipt("CASH", changeDue, null));
    resetSaleState();
    setToast(`Sale queued - change due: KES ${changeDue.toFixed(2)}`);
    setTimeout(() => setToast(null), 4000);
    void sync.runSync();
  }

  // M-Pesa is inherently online-only (the STK push itself is a live round
  // trip to Daraja) - submitted directly, same as the pharmacy path, not
  // queued through the offline outbox the way a cash sale is.
  async function initiateMpesaPush() {
    if (!device || !session || cartEntries.length === 0) return;
    const phone = normalizeKenyanPhone(mpesaPhone);
    if (!phone) {
      setMpesaError("Enter a valid Safaricom number, e.g. 0712345678");
      return;
    }
    setMpesaError(null);
    setMpesaStatus("sending");
    try {
      const result = await apiPost<{ checkoutRequestId: string }>(
        "/payments/mpesa/initiate",
        { amountKes: totals.total, reference: saleClientIdRef.current, phoneNumber: phone },
        session.accessToken,
      );
      setMpesaStatus("pending");
      mpesaPollDeadline.current = Date.now() + MPESA_POLL_TIMEOUT_MS;
      mpesaPollTimer.current = setInterval(() => void pollMpesaStatus(result.checkoutRequestId), MPESA_POLL_INTERVAL_MS);
    } catch (err) {
      setMpesaStatus("failed");
      if (err instanceof OfflineError) {
        setMpesaError("Offline - M-Pesa needs a connection to send the STK push.");
      } else {
        setMpesaError(err instanceof ApiError ? err.message : "Could not start M-Pesa payment.");
      }
    }
  }

  async function pollMpesaStatus(checkoutRequestId: string) {
    if (!session) return;
    if (Date.now() > mpesaPollDeadline.current) {
      if (mpesaPollTimer.current) clearInterval(mpesaPollTimer.current);
      setMpesaStatus("failed");
      setMpesaError("No confirmation from M-Pesa yet - ask the customer to check their phone, or try again.");
      return;
    }
    try {
      const result = await apiGet<MpesaStatusResponse>(
        `/payments/mpesa/status/${checkoutRequestId}`,
        session.accessToken,
      );
      if (result.status === "SUCCESS") {
        if (mpesaPollTimer.current) clearInterval(mpesaPollTimer.current);
        setMpesaStatus("success");
        await submitMpesaSale(checkoutRequestId, result.mpesaReceiptNumber);
      } else if (result.status === "FAILED") {
        if (mpesaPollTimer.current) clearInterval(mpesaPollTimer.current);
        setMpesaStatus("failed");
        setMpesaError(result.resultDesc ?? "Payment was not completed on the customer's phone.");
      }
      // PENDING - keep polling.
    } catch {
      // Transient poll failure - keep trying until the deadline rather than
      // failing the whole payment over one dropped request.
    }
  }

  async function submitMpesaSale(checkoutRequestId: string, mpesaReceiptNumber: string | null) {
    if (!device || !session) return;
    const phone = normalizeKenyanPhone(mpesaPhone)!;
    const points = Number(redeemPoints);
    const redeemAmount = customer && Number.isFinite(points) && points > 0 ? Math.min(points, customer.loyaltyPoints) : undefined;
    try {
      await apiPost(
        "/sales",
        {
          clientId: saleClientIdRef.current,
          branchId: device.branchId,
          terminalId: device.terminalId,
          cashierSessionId: session.cashierSessionId,
          lineItems: cartEntries.map((e) => ({ variantId: e.variant.id, quantity: e.quantity })),
          payments: [{ method: "MPESA", amount: totals.total, phoneNumber: phone, providerReference: checkoutRequestId }],
          discount: discount ?? undefined,
          customerId: customer?.id ?? undefined,
          redeemPoints: redeemAmount,
        },
        session.accessToken,
      );
      setReceipt(buildReceipt("MPESA", null, mpesaReceiptNumber));
      resetSaleState();
      setToast("M-Pesa payment confirmed - sale complete.");
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setMpesaStatus("failed");
      setMpesaError(
        err instanceof ApiError
          ? `Payment was confirmed by M-Pesa but the sale failed to record: ${err.message}. Do not charge the customer again - contact a supervisor.`
          : "Payment was confirmed by M-Pesa but the sale failed to record - contact a supervisor.",
      );
    }
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
      setReceipt(buildReceipt("CASH", Math.max(0, amount - totals.total), null, clientId));
      resetSaleState();
      setPrescriptionModalOpen(false);
      setPendingClientId(null);
      setPrescriptionNumber("");
      setPrescriberName("");
      setIssuedDate("");
      setToast(`Sale complete - change due: KES ${Math.max(0, amount - totals.total).toFixed(2)}`);
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
      <div className="flex min-h-screen items-center justify-center bg-secondary-900 text-secondary-100">
        <p>Loading...</p>
      </div>
    );
  }

  const isPharmacy = device.industryType === "PHARMACY";

  return (
    <div className="flex h-screen flex-col bg-secondary-900 text-secondary-100">
      <header className="flex items-center justify-between border-b border-secondary-800 p-3">
        <div>
          <p className="font-semibold">{session.cashierName}</p>
          <p className="text-xs text-secondary-400">
            {sync.isSyncing ? "Syncing..." : sync.pendingCount > 0 ? `${sync.pendingCount} sale(s) pending sync` : "All synced"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {device.industryType === "RESTAURANT" && (
            <>
              <button onClick={() => router.push("/tables")} className="min-h-touch rounded-md bg-secondary-800 px-3 py-2 text-sm hover:bg-secondary-700">
                Tables
              </button>
              <button onClick={() => router.push("/kds")} className="min-h-touch rounded-md bg-secondary-800 px-3 py-2 text-sm hover:bg-secondary-700">
                Kitchen
              </button>
            </>
          )}
          {device.industryType === "SALON" && (
            <button onClick={() => router.push("/salon")} className="min-h-touch rounded-md bg-secondary-800 px-3 py-2 text-sm hover:bg-secondary-700">
              Bookings
            </button>
          )}
          <button onClick={() => router.push("/returns")} className="min-h-touch rounded-md bg-secondary-800 px-3 py-2 text-sm hover:bg-secondary-700">
            Returns
          </button>
          <button onClick={() => router.push("/shift")} className="min-h-touch rounded-md bg-secondary-800 px-3 py-2 text-sm hover:bg-secondary-700">
            End shift
          </button>
          <button onClick={switchCashier} className="min-h-touch rounded-md bg-secondary-800 px-3 py-2 text-sm hover:bg-secondary-700">
            Switch cashier
          </button>
        </div>
      </header>

      {toast && <div className="bg-success-700 p-2 text-center text-sm">{toast}</div>}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden p-3">
          <input
            className="mb-3 rounded-md border border-secondary-700 bg-secondary-800 p-2.5 text-secondary-100 placeholder:text-secondary-500"
            placeholder="Search product, SKU, or scan barcode... · Tafuta bidhaa"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {filtered.map((variant) => (
              <button
                key={variant.id}
                onClick={() => addToCart(variant)}
                className="flex min-h-touch flex-col items-start rounded-lg bg-secondary-800 p-3 text-left transition-colors hover:bg-secondary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span className="font-medium">{variant.productName}</span>
                <span className="text-xs text-secondary-400">{variant.sku}</span>
                <span className="mt-1 font-mono text-lg font-bold text-primary-400">KES {variant.price.toFixed(2)}</span>
              </button>
            ))}
            {filtered.length === 0 && variants.length > 0 && (
              <p className="col-span-full text-center text-secondary-400">No matching products.</p>
            )}
            {variants.length === 0 && (
              <p className="col-span-full text-center text-secondary-400">
                No products cached yet - run terminal setup while online first.
              </p>
            )}
          </div>
        </div>

        <div className="flex w-80 flex-col border-l border-secondary-800 p-3">
          <h2 className="font-semibold">Cart · Rukwama</h2>

          <div className="mt-2 space-y-2">
            {customer ? (
              <div className="flex items-center justify-between rounded-md bg-secondary-800 p-2 text-sm">
                <div>
                  <p className="font-medium">{customer.name}</p>
                  <p className="text-xs text-secondary-400">{customer.loyaltyPoints} pts</p>
                </div>
                <button onClick={() => { setCustomer(null); setRedeemPoints(""); }} className="min-h-touch px-2 text-xs text-error-500">
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCustomerModalOpen(true)}
                className="min-h-touch w-full rounded-md border border-dashed border-secondary-700 p-2 text-sm text-secondary-400 hover:border-secondary-500"
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
                className="w-full rounded-md border border-secondary-700 bg-secondary-800 p-2 text-sm text-secondary-100"
              />
            )}

            {discount ? (
              <div className="flex items-center justify-between rounded-md bg-secondary-800 p-2 text-sm">
                <span>
                  Discount: {discount.type === "PERCENT" ? `${discount.value}%` : `KES ${discount.value.toFixed(2)}`}
                </span>
                <button onClick={() => setDiscount(null)} className="min-h-touch px-2 text-xs text-error-500">
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDiscountModalOpen(true)}
                disabled={approvers.length === 0}
                className="min-h-touch w-full rounded-md border border-dashed border-secondary-700 p-2 text-sm text-secondary-400 hover:border-secondary-500 disabled:opacity-40"
              >
                + Apply discount
              </button>
            )}
          </div>

          <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
            {cartEntries.map(({ variant, quantity }) => (
              <div key={variant.id} className="rounded-md bg-secondary-800 p-2">
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
                        className="w-20 rounded bg-secondary-700 p-1 text-center"
                      />
                      <span className="text-xs text-secondary-400">wt</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setQuantity(variant.id, quantity - 1)} className="h-8 w-8 rounded bg-secondary-700 hover:bg-secondary-600">
                        -
                      </button>
                      <span className="w-6 text-center">{quantity}</span>
                      <button onClick={() => setQuantity(variant.id, quantity + 1)} className="h-8 w-8 rounded bg-secondary-700 hover:bg-secondary-600">
                        +
                      </button>
                    </div>
                  )}
                  <span className="font-mono">KES {(variant.price * quantity).toFixed(2)}</span>
                </div>
                {isPharmacy && (
                  <select
                    value={lineBatches.get(variant.id) ?? ""}
                    onFocus={() => void loadBatchesFor(variant.id)}
                    onChange={(e) => setLineBatch(variant.id, e.target.value)}
                    className="mt-2 w-full rounded-md border border-secondary-700 bg-secondary-900 p-1.5 text-xs"
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
            {cartEntries.length === 0 && <p className="text-sm text-secondary-500">Cart is empty · Rukwama iko wazi.</p>}
          </div>

          <div className="mt-3 space-y-1 border-t border-secondary-700 pt-3 text-sm">
            <div className="flex justify-between text-secondary-400">
              <span>Subtotal</span>
              <span>KES {totals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-secondary-400">
              <span>Tax (VAT)</span>
              <span>KES {totals.tax.toFixed(2)}</span>
            </div>
            {totals.discountAmount > 0 && (
              <div className="flex justify-between text-warning-500">
                <span>Discount</span>
                <span>-KES {totals.discountAmount.toFixed(2)}</span>
              </div>
            )}
            {totals.redemptionValue > 0 && (
              <div className="flex justify-between text-warning-500">
                <span>Points redeemed</span>
                <span>-KES {totals.redemptionValue.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-pos-total">
              <span className="text-lg font-bold">Total</span>
              <span>KES {totals.total.toFixed(2)}</span>
            </div>
          </div>

          <Button
            onClick={openCheckout}
            disabled={cartEntries.length === 0}
            variant="primary"
            size="touch"
            className="mt-3 w-full"
          >
            Charge · Lipa
          </Button>
        </div>
      </div>

      {checkoutOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-secondary-800 p-6">
            {isPharmacy ? (
              <>
                <h2 className="text-xl font-bold">Cash payment</h2>
                <p className="mt-1 text-secondary-400">Total due: KES {totals.total.toFixed(2)}</p>
                <input
                  type="number"
                  autoFocus
                  className="mt-4 w-full rounded-md border border-secondary-600 bg-secondary-900 p-3 text-lg"
                  placeholder="Amount tendered"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                />
                {Number(tendered) >= totals.total && (
                  <p className="mt-2 text-success-500">Change due: KES {(Number(tendered) - totals.total).toFixed(2)}</p>
                )}
                {pharmacyError && <p className="mt-2 text-sm text-error-500">{pharmacyError}</p>}
                <div className="mt-4 flex gap-3">
                  <Button onClick={closeCheckout} variant="secondary" size="touch" className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    onClick={completeCashSale}
                    disabled={pharmacyBusy || !Number.isFinite(Number(tendered)) || Number(tendered) < totals.total - 0.01}
                    variant="primary"
                    size="touch"
                    className="flex-1"
                  >
                    {pharmacyBusy ? "..." : "Confirm"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold">Payment · Malipo</h2>
                <p className="mt-1 text-secondary-400">Total due: KES {totals.total.toFixed(2)}</p>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setTenderMethod("CASH")}
                    className={`min-h-touch rounded-lg border p-3 text-sm font-medium transition-colors ${
                      tenderMethod === "CASH" ? "border-primary-500 bg-primary-600/20 text-primary-300" : "border-secondary-600 bg-secondary-900 text-secondary-300 hover:bg-secondary-700"
                    }`}
                  >
                    Cash
                  </button>
                  <button
                    onClick={() => setTenderMethod("MPESA")}
                    className={`min-h-touch rounded-lg border p-3 text-sm font-medium transition-colors ${
                      tenderMethod === "MPESA" ? "border-accent-500 bg-accent-700/20 text-accent-500" : "border-secondary-600 bg-secondary-900 text-secondary-300 hover:bg-secondary-700"
                    }`}
                  >
                    M-Pesa
                  </button>
                  <button
                    disabled
                    title="Card processor not yet configured for this org"
                    className="min-h-touch rounded-lg border border-secondary-700 bg-secondary-900 p-3 text-sm font-medium text-secondary-600 opacity-50"
                  >
                    Card <Badge variant="neutral" className="ml-1">Soon</Badge>
                  </button>
                  <button
                    disabled
                    title="Split payment not yet available"
                    className="min-h-touch rounded-lg border border-secondary-700 bg-secondary-900 p-3 text-sm font-medium text-secondary-600 opacity-50"
                  >
                    Split <Badge variant="neutral" className="ml-1">Soon</Badge>
                  </button>
                </div>

                {tenderMethod === "CASH" && (
                  <>
                    <input
                      type="number"
                      autoFocus
                      className="mt-4 w-full rounded-md border border-secondary-600 bg-secondary-900 p-3 text-lg"
                      placeholder="Amount tendered"
                      value={tendered}
                      onChange={(e) => setTendered(e.target.value)}
                    />
                    {Number(tendered) >= totals.total && (
                      <p className="mt-2 text-success-500">Change due: KES {(Number(tendered) - totals.total).toFixed(2)}</p>
                    )}
                    <div className="mt-4 flex gap-3">
                      <Button onClick={closeCheckout} variant="secondary" size="touch" className="flex-1">
                        Cancel
                      </Button>
                      <Button
                        onClick={completeCashSale}
                        disabled={!Number.isFinite(Number(tendered)) || Number(tendered) < totals.total - 0.01}
                        variant="primary"
                        size="touch"
                        className="flex-1"
                      >
                        Confirm
                      </Button>
                    </div>
                  </>
                )}

                {tenderMethod === "MPESA" && (
                  <div className="mt-4">
                    {(mpesaStatus === "idle" || mpesaStatus === "sending") && (
                      <>
                        <label className="mb-1.5 block text-sm text-secondary-400">Customer M-Pesa number</label>
                        <input
                          type="tel"
                          autoFocus
                          placeholder="07XX XXX XXX"
                          className="w-full rounded-md border border-secondary-600 bg-secondary-900 p-3 text-lg"
                          value={mpesaPhone}
                          onChange={(e) => setMpesaPhone(e.target.value)}
                        />
                        {mpesaError && <p className="mt-2 text-sm text-error-500">{mpesaError}</p>}
                        <div className="mt-4 flex gap-3">
                          <Button onClick={closeCheckout} variant="secondary" size="touch" className="flex-1">
                            Cancel
                          </Button>
                          <Button
                            onClick={initiateMpesaPush}
                            disabled={mpesaStatus === "sending"}
                            variant="mpesa"
                            className="flex-1"
                            size="touch"
                          >
                            {mpesaStatus === "sending" ? "Sending..." : "Send STK push"}
                          </Button>
                        </div>
                      </>
                    )}

                    {mpesaStatus === "pending" && (
                      <div className="flex flex-col items-center py-4 text-center">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent-700 border-t-accent-400" />
                        <p className="mt-4 font-medium text-accent-400">Waiting for customer to approve on their phone…</p>
                        <p className="mt-1 text-sm text-secondary-400">Ask them to check the M-Pesa prompt on {mpesaPhone}</p>
                        <button
                          onClick={closeCheckout}
                          className="mt-4 min-h-touch text-sm text-secondary-400 underline"
                        >
                          Cancel and pick another tender
                        </button>
                      </div>
                    )}

                    {mpesaStatus === "success" && (
                      <div className="flex flex-col items-center py-4 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-600 text-2xl">✓</div>
                        <p className="mt-4 font-medium text-success-500">Payment confirmed - recording sale…</p>
                      </div>
                    )}

                    {mpesaStatus === "failed" && (
                      <div className="text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-error-700/30 text-2xl text-error-500">!</div>
                        <p className="mt-3 text-sm text-error-500">{mpesaError ?? "Payment was not completed."}</p>
                        <div className="mt-4 flex gap-3">
                          <Button onClick={closeCheckout} variant="secondary" size="touch" className="flex-1">
                            Cancel
                          </Button>
                          <Button
                            onClick={() => {
                              setMpesaStatus("idle");
                              setMpesaError(null);
                            }}
                            variant="mpesa"
                            className="flex-1"
                            size="touch"
                          >
                            Try again
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {prescriptionModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-secondary-800 p-6">
            <h2 className="text-xl font-bold">Prescription required</h2>
            <p className="mt-1 text-sm text-warning-500">{prescriptionMessage}</p>
            <input
              className="mt-4 w-full rounded-md border border-secondary-600 bg-secondary-900 p-3"
              placeholder="Prescription number"
              value={prescriptionNumber}
              onChange={(e) => setPrescriptionNumber(e.target.value)}
            />
            <input
              className="mt-3 w-full rounded-md border border-secondary-600 bg-secondary-900 p-3"
              placeholder="Prescriber name"
              value={prescriberName}
              onChange={(e) => setPrescriberName(e.target.value)}
            />
            <input
              type="date"
              className="mt-3 w-full rounded-md border border-secondary-600 bg-secondary-900 p-3"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
            />
            {pharmacyError && <p className="mt-2 text-sm text-error-500">{pharmacyError}</p>}
            <div className="mt-4 flex gap-3">
              <Button
                onClick={() => {
                  setPrescriptionModalOpen(false);
                  setPendingClientId(null);
                  setPharmacyError(null);
                }}
                variant="secondary"
                size="touch"
                className="flex-1"
              >
                Cancel sale
              </Button>
              <Button
                onClick={() => void submitPrescriptionAndRetry()}
                disabled={pharmacyBusy || !prescriptionNumber.trim() || !prescriberName.trim() || !issuedDate}
                variant="primary"
                size="touch"
                className="flex-1"
              >
                {pharmacyBusy ? "..." : "Submit"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {customerModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-secondary-800 p-6">
            <h2 className="text-xl font-bold">Attach customer</h2>
            <input
              autoFocus
              className="mt-4 w-full rounded-md border border-secondary-600 bg-secondary-900 p-3"
              placeholder="Search name or phone..."
              value={customerSearch}
              onChange={(e) => void searchCustomers(e.target.value)}
            />
            {customerError && <p className="mt-2 text-sm text-error-500">{customerError}</p>}
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
                  className="flex w-full items-center justify-between rounded-md bg-secondary-900 p-2 text-left hover:bg-secondary-700"
                >
                  <span>{c.name}</span>
                  <span className="text-xs text-secondary-400">{c.phone ?? "no phone"} · {c.loyaltyPoints} pts</span>
                </button>
              ))}
              {customerBusy && <p className="text-sm text-secondary-400">Searching...</p>}
            </div>
            {customerSearch.trim().length > 0 && customerResults.length === 0 && !customerBusy && (
              <button
                onClick={() => void createCustomer(customerSearch, "")}
                className="mt-3 w-full min-h-touch rounded-md bg-primary-600 p-2 text-sm font-semibold hover:bg-primary-700"
              >
                + New customer &quot;{customerSearch.trim()}&quot;
              </button>
            )}
            <Button
              onClick={() => {
                setCustomerModalOpen(false);
                setCustomerSearch("");
                setCustomerResults([]);
                setCustomerError(null);
              }}
              variant="secondary"
              size="touch"
              className="mt-4 w-full"
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {discountModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-secondary-800 p-6">
            <h2 className="text-xl font-bold">Apply discount</h2>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setDiscountType("PERCENT")}
                className={`min-h-touch flex-1 rounded-md p-2 ${discountType === "PERCENT" ? "bg-primary-600" : "bg-secondary-700"}`}
              >
                Percent
              </button>
              <button
                onClick={() => setDiscountType("FIXED")}
                className={`min-h-touch flex-1 rounded-md p-2 ${discountType === "FIXED" ? "bg-primary-600" : "bg-secondary-700"}`}
              >
                Fixed (KES)
              </button>
            </div>
            <input
              type="number"
              className="mt-3 w-full rounded-md border border-secondary-600 bg-secondary-900 p-3"
              placeholder={discountType === "PERCENT" ? "e.g. 10" : "e.g. 200"}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
            <p className="mt-4 text-sm text-secondary-400">Approved by (supervisor+):</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {approvers.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setDiscountApproverId(a.id)}
                  className={`min-h-touch w-full rounded-md p-2 text-left ${discountApproverId === a.id ? "bg-primary-600" : "bg-secondary-900 hover:bg-secondary-700"}`}
                >
                  {a.fullName} <span className="text-xs text-secondary-400">({a.role})</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                onClick={() => {
                  setDiscountModalOpen(false);
                  setDiscountValue("");
                  setDiscountApproverId("");
                }}
                variant="secondary"
                size="touch"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={applyDiscount}
                disabled={!Number.isFinite(Number(discountValue)) || Number(discountValue) <= 0 || !discountApproverId}
                variant="primary"
                size="touch"
                className="flex-1"
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-6 text-secondary-900 print:max-h-none print:overflow-visible">
            <div className="text-center">
              <p className="font-bold">{receipt.branchName}</p>
              <p className="text-xs text-secondary-500">Zaroda POS</p>
              <p className="mt-2 text-xs text-secondary-500">{new Date(receipt.createdAt).toLocaleString()}</p>
              <p className="text-xs text-secondary-500">Cashier: {receipt.cashierName}</p>
              <p className="mt-1 font-mono text-[11px] text-secondary-400">Ref: {receipt.clientId}</p>
            </div>

            <div className="my-3 border-t border-dashed border-secondary-300" />

            <table className="w-full text-xs">
              <tbody>
                {receipt.items.map((item, i) => (
                  <tr key={i}>
                    <td className="py-1 align-top">
                      <p>{item.name}</p>
                      <p className="text-secondary-400">{item.quantity} × KES {item.unitPrice.toFixed(2)}</p>
                    </td>
                    <td className="py-1 text-right align-top font-mono">KES {item.lineTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="my-3 border-t border-dashed border-secondary-300" />

            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-secondary-500">Subtotal</dt><dd>KES {receipt.subtotal.toFixed(2)}</dd></div>
              <div className="flex justify-between"><dt className="text-secondary-500">VAT</dt><dd>KES {receipt.tax.toFixed(2)}</dd></div>
              {receipt.discountAmount > 0 && (
                <div className="flex justify-between text-warning-600"><dt>Discount</dt><dd>-KES {receipt.discountAmount.toFixed(2)}</dd></div>
              )}
              {receipt.redemptionValue > 0 && (
                <div className="flex justify-between text-warning-600"><dt>Points redeemed</dt><dd>-KES {receipt.redemptionValue.toFixed(2)}</dd></div>
              )}
              <div className="flex justify-between border-t border-secondary-200 pt-1.5 text-base font-bold"><dt>Total</dt><dd>KES {receipt.total.toFixed(2)}</dd></div>
              <div className="flex justify-between text-secondary-500">
                <dt>Paid via</dt>
                <dd>{receipt.tenderMethod === "MPESA" ? "M-Pesa" : "Cash"}</dd>
              </div>
              {receipt.changeDue !== null && (
                <div className="flex justify-between text-secondary-500"><dt>Change</dt><dd>KES {receipt.changeDue.toFixed(2)}</dd></div>
              )}
              {receipt.mpesaReceiptNumber && (
                <div className="flex justify-between text-secondary-500"><dt>M-Pesa receipt</dt><dd className="font-mono">{receipt.mpesaReceiptNumber}</dd></div>
              )}
            </dl>

            <div className="my-3 border-t border-dashed border-secondary-300" />

            <div className="flex flex-col items-center gap-1 text-center">
              <div
                className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed border-secondary-300 bg-secondary-50 text-center text-[10px] leading-tight text-secondary-400"
                aria-label="eTIMS QR code placeholder"
              >
                eTIMS QR<br />pending KRA<br />integration
              </div>
              <p className="mt-1 text-[10px] text-secondary-400">
                Control unit invoice #: not yet assigned - eTIMS sync is not configured for this org.
              </p>
            </div>

            <div className="mt-5 flex gap-3 print:hidden">
              <Button onClick={() => setReceipt(null)} variant="secondary" size="touch" className="flex-1">
                New sale
              </Button>
              <Button onClick={() => window.print()} variant="primary" size="touch" className="flex-1">
                Print
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
