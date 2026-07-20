"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db, getActiveSession, getDeviceConfig, type CachedVariant, type CashierSession, type DeviceConfig } from "../../lib/db";
import { apiGet, apiPatch, apiPost, ApiError, OfflineError } from "../../lib/api";

type AppointmentStatus = "SCHEDULED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

interface SalonResource {
  id: string;
  branchId: string;
  name: string;
}

interface Appointment {
  id: string;
  branchId: string;
  resourceId: string;
  customerId: string | null;
  serviceName: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  resource: SalonResource;
  customer: { id: string; name: string } | null;
}

interface CheckoutLine {
  variant: CachedVariant;
  quantity: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  loyaltyPoints: number;
}

// 1 loyalty point = KES 1 off (SalesService.LOYALTY_REDEEM_VALUE) - no
// endpoint exposes this rate, mirrored here for the redemption preview
// only, same as the plain POS screen. The server computes and enforces
// the real value.
const LOYALTY_REDEEM_VALUE = 1;

// Mirrors SalonAppointmentsService's ALLOWED_TRANSITIONS - a UX guide for
// which buttons to show, not the authorization boundary. The server
// re-checks every transition independently; a stale client showing a
// button that's no longer valid just gets a 400 back, same as anywhere
// else in this app.
const NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["IN_PROGRESS", "CANCELLED", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED: "border-slate-600",
  CONFIRMED: "border-blue-600",
  IN_PROGRESS: "border-amber-600",
  COMPLETED: "border-green-600",
  CANCELLED: "border-red-900",
  NO_SHOW: "border-red-900",
};

/**
 * Booking book + checkout, on the same "module calls into core" pattern
 * as the restaurant/pharmacy screens - online-only, same reasoning as
 * the restaurant floor: a booking that hasn't actually reached the
 * server isn't preventing a real double-booking, so there's no useful
 * offline-queued version of this screen.
 */
export default function SalonPage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [resources, setResources] = useState<SalonResource[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [variants, setVariants] = useState<CachedVariant[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [newResourceId, setNewResourceId] = useState("");
  const [newServiceName, setNewServiceName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newCustomer, setNewCustomer] = useState<Customer | null>(null);
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const [checkoutTarget, setCheckoutTarget] = useState<Appointment | null>(null);
  const [checkoutLines, setCheckoutLines] = useState<CheckoutLine[]>([]);
  const [checkoutSearch, setCheckoutSearch] = useState("");
  const [checkoutCustomer, setCheckoutCustomer] = useState<Customer | null>(null);
  const [checkoutRedeemPoints, setCheckoutRedeemPoints] = useState("");
  const [tendered, setTendered] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Shared customer-search picker, reused for both the New-booking form
  // and checkout - customerPickerFor says which one the result gets
  // assigned to, the same modal either way.
  const [customerPickerFor, setCustomerPickerFor] = useState<"new" | "checkout" | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) return router.replace("/setup");
      const activeSession = await getActiveSession();
      if (!activeSession) return router.replace("/login");
      if (config.industryType !== "SALON") return router.replace("/pos");
      setDevice(config);
      setSession(activeSession);
      setVariants(await db.variants.toArray());
      await refresh(config, activeSession);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refresh(config: DeviceConfig, activeSession: CashierSession) {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      const [resourceList, appointmentList] = await Promise.all([
        apiGet<SalonResource[]>(`/salon/resources?branchId=${config.branchId}`, activeSession.accessToken),
        apiGet<Appointment[]>(
          `/salon/appointments?branchId=${config.branchId}&from=${startOfDay.toISOString()}&to=${endOfDay.toISOString()}`,
          activeSession.accessToken,
        ),
      ]);
      setResources(resourceList);
      setNewResourceId((prev) => prev || resourceList[0]?.id || "");
      setAppointments(appointmentList);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof OfflineError ? "Offline - the booking book needs a connection." : "Could not load appointments.");
    }
  }

  const sorted = useMemo(
    () => [...appointments].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [appointments],
  );

  const filteredVariants = useMemo(() => {
    const q = checkoutSearch.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter((v) => v.productName.toLowerCase().includes(q));
  }, [variants, checkoutSearch]);

  const checkoutTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const { variant, quantity } of checkoutLines) {
      const lineSubtotal = variant.price * quantity;
      subtotal += lineSubtotal;
      tax += lineSubtotal * variant.taxRate;
    }
    const preRedemptionTotal = subtotal + tax;

    const points = Number(checkoutRedeemPoints);
    const maxRedeemable = checkoutCustomer ? checkoutCustomer.loyaltyPoints : 0;
    const redemptionValue =
      Number.isFinite(points) && points > 0 ? Math.min(points, maxRedeemable) * LOYALTY_REDEEM_VALUE : 0;

    const total = Math.max(0, preRedemptionTotal - redemptionValue);
    return { subtotal, tax, redemptionValue, total };
  }, [checkoutLines, checkoutRedeemPoints, checkoutCustomer]);

  async function createAppointment() {
    if (!device || !session || !newResourceId || !newServiceName.trim() || !newStart || !newEnd) return;
    setNewBusy(true);
    setNewError(null);
    try {
      await apiPost(
        "/salon/appointments",
        {
          branchId: device.branchId,
          resourceId: newResourceId,
          customerId: newCustomer?.id,
          serviceName: newServiceName.trim(),
          startTime: new Date(newStart).toISOString(),
          endTime: new Date(newEnd).toISOString(),
        },
        session.accessToken,
      );
      setNewOpen(false);
      setNewServiceName("");
      setNewStart("");
      setNewEnd("");
      setNewCustomer(null);
      await refresh(device, session);
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : err instanceof OfflineError ? "Offline." : "Could not book appointment.");
    } finally {
      setNewBusy(false);
    }
  }

  async function setStatus(appointment: Appointment, status: AppointmentStatus) {
    if (!device || !session) return;
    setStatusBusyId(appointment.id);
    try {
      await apiPatch(`/salon/appointments/${appointment.id}/status`, { status }, session.accessToken);
      await refresh(device, session);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setStatusBusyId(null);
    }
  }

  function openCheckout(appointment: Appointment) {
    setCheckoutTarget(appointment);
    setCheckoutLines([]);
    setCheckoutSearch("");
    setCheckoutCustomer(null);
    setCheckoutRedeemPoints("");
    setTendered("");
    setCheckoutError(null);
  }

  function openCustomerPicker(target: "new" | "checkout") {
    setCustomerPickerFor(target);
    setCustomerSearch("");
    setCustomerResults([]);
    setCustomerError(null);
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
      selectCustomer(created);
    } catch (err) {
      setCustomerError(err instanceof ApiError ? err.message : "Could not create customer.");
    } finally {
      setCustomerBusy(false);
    }
  }

  function selectCustomer(c: Customer) {
    if (customerPickerFor === "new") setNewCustomer(c);
    else if (customerPickerFor === "checkout") setCheckoutCustomer(c);
    setCustomerPickerFor(null);
    setCustomerSearch("");
    setCustomerResults([]);
  }

  function addCheckoutLine(variant: CachedVariant) {
    setCheckoutLines((prev) => {
      const idx = prev.findIndex((l) => l.variant.id === variant.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { variant, quantity: 1 }];
    });
  }

  function setCheckoutQuantity(index: number, quantity: number) {
    setCheckoutLines((prev) => {
      if (quantity <= 0) return prev.filter((_, i) => i !== index);
      const next = [...prev];
      next[index] = { ...next[index], quantity };
      return next;
    });
  }

  async function submitCheckout() {
    if (!device || !session || !checkoutTarget || checkoutLines.length === 0) return;
    const amount = Number(tendered);
    if (!Number.isFinite(amount) || amount < checkoutTotals.total - 0.01) return;

    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      await apiPost(
        `/salon/appointments/${checkoutTarget.id}/checkout`,
        {
          clientId: crypto.randomUUID(),
          terminalId: device.terminalId,
          cashierSessionId: session.cashierSessionId,
          lineItems: checkoutLines.map((l) => ({ variantId: l.variant.id, quantity: l.quantity })),
          payments: [{ method: "CASH", amount: checkoutTotals.total }],
          customerId: checkoutCustomer?.id,
          redeemPoints:
            checkoutCustomer && Number.isFinite(Number(checkoutRedeemPoints)) && Number(checkoutRedeemPoints) > 0
              ? Math.min(Number(checkoutRedeemPoints), checkoutCustomer.loyaltyPoints)
              : undefined,
        },
        session.accessToken,
      );
      setToast(`Checked out - change due: ${Math.max(0, amount - checkoutTotals.total).toFixed(2)}`);
      setTimeout(() => setToast(null), 4000);
      setCheckoutTarget(null);
      setCheckoutLines([]);
      setCheckoutCustomer(null);
      setCheckoutRedeemPoints("");
      setTendered("");
      await refresh(device, session);
    } catch (err) {
      setCheckoutError(
        err instanceof OfflineError ? "Offline - checkout needs a connection." : err instanceof ApiError ? err.message : "Checkout failed.",
      );
    } finally {
      setCheckoutBusy(false);
    }
  }

  if (!device || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
        <p>Loading...</p>
      </div>
    );
  }

  if (checkoutTarget) {
    return (
      <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
        <header className="flex items-center justify-between border-b border-slate-800 p-3">
          <button onClick={() => setCheckoutTarget(null)} className="text-blue-400">
            &larr; Bookings
          </button>
          <p className="font-semibold">
            {checkoutTarget.serviceName} - {checkoutTarget.resource.name}
          </p>
          <span className="w-16" />
        </header>

        {checkoutError && <div className="bg-red-900 p-2 text-center text-sm">{checkoutError}</div>}

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden p-3">
            <input
              className="mb-3 rounded-md border border-slate-700 bg-slate-800 p-2.5"
              placeholder="Search service/product..."
              value={checkoutSearch}
              onChange={(e) => setCheckoutSearch(e.target.value)}
            />
            <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
              {filteredVariants.map((variant) => (
                <button
                  key={variant.id}
                  onClick={() => addCheckoutLine(variant)}
                  className="flex flex-col items-start rounded-lg bg-slate-800 p-3 text-left hover:bg-slate-700"
                >
                  <span className="font-medium">{variant.productName}</span>
                  <span className="mt-1 font-mono text-lg font-bold text-blue-400">KES {variant.price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex w-80 flex-col border-l border-slate-800 p-3">
            <h2 className="font-semibold">Checkout</h2>

            <div className="mt-2 space-y-2">
              {checkoutCustomer ? (
                <div className="flex items-center justify-between rounded-md bg-slate-800 p-2 text-sm">
                  <div>
                    <p className="font-medium">{checkoutCustomer.name}</p>
                    <p className="text-xs text-slate-400">{checkoutCustomer.loyaltyPoints} pts</p>
                  </div>
                  <button onClick={() => { setCheckoutCustomer(null); setCheckoutRedeemPoints(""); }} className="text-xs text-red-400">
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => openCustomerPicker("checkout")}
                  className="w-full rounded-md border border-dashed border-slate-700 p-2 text-sm text-slate-400 hover:border-slate-500"
                >
                  + Attach customer
                </button>
              )}
              {checkoutCustomer && checkoutCustomer.loyaltyPoints > 0 && (
                <input
                  type="number"
                  min={0}
                  max={checkoutCustomer.loyaltyPoints}
                  placeholder={`Redeem points (max ${checkoutCustomer.loyaltyPoints})`}
                  value={checkoutRedeemPoints}
                  onChange={(e) => setCheckoutRedeemPoints(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
                />
              )}
            </div>

            <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
              {checkoutLines.map((line, i) => (
                <div key={line.variant.id} className="rounded-md bg-slate-800 p-2">
                  <p className="text-sm font-medium">{line.variant.productName}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setCheckoutQuantity(i, line.quantity - 1)} className="h-7 w-7 rounded bg-slate-700">
                        -
                      </button>
                      <span className="w-6 text-center">{line.quantity}</span>
                      <button onClick={() => setCheckoutQuantity(i, line.quantity + 1)} className="h-7 w-7 rounded bg-slate-700">
                        +
                      </button>
                    </div>
                    <span className="font-mono">KES {(line.variant.price * line.quantity).toFixed(2)}</span>
                  </div>
                </div>
              ))}
              {checkoutLines.length === 0 && <p className="text-sm text-slate-500">Add the service/product lines to charge.</p>}
            </div>

            <div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span>
                <span>KES {checkoutTotals.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Tax</span>
                <span>KES {checkoutTotals.tax.toFixed(2)}</span>
              </div>
              {checkoutTotals.redemptionValue > 0 && (
                <div className="flex justify-between text-amber-400">
                  <span>Points redeemed</span>
                  <span>-KES {checkoutTotals.redemptionValue.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>KES {checkoutTotals.total.toFixed(2)}</span>
              </div>
            </div>

            <input
              type="number"
              className="mt-3 w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              placeholder="Amount tendered"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
            />
            {Number(tendered) >= checkoutTotals.total && checkoutLines.length > 0 && (
              <p className="mt-2 text-sm text-green-400">Change due: KES {(Number(tendered) - checkoutTotals.total).toFixed(2)}</p>
            )}
            <button
              onClick={() => void submitCheckout()}
              disabled={checkoutBusy || checkoutLines.length === 0 || !Number.isFinite(Number(tendered)) || Number(tendered) < checkoutTotals.total - 0.01}
              className="mt-3 w-full rounded-md bg-blue-600 p-3 font-semibold hover:bg-blue-500 disabled:opacity-40"
            >
              {checkoutBusy ? "Charging..." : "Charge (Cash)"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 p-3">
        <button onClick={() => router.push("/pos")} className="text-blue-400">
          &larr; POS
        </button>
        <p className="font-semibold">Today&apos;s bookings</p>
        <button onClick={() => setNewOpen(true)} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">
          + New
        </button>
      </header>

      {toast && <div className="bg-green-800 p-2 text-center text-sm">{toast}</div>}
      {loadError && <div className="bg-red-900 p-2 text-center text-sm">{loadError}</div>}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {sorted.map((a) => (
          <div key={a.id} className={`rounded-lg border-2 bg-slate-800 p-3 ${STATUS_COLOR[a.status]}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">
                  {a.serviceName} · {a.resource.name}
                </p>
                <p className="text-sm text-slate-400">
                  {new Date(a.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -{" "}
                  {new Date(a.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {a.customer && ` · ${a.customer.name}`}
                </p>
              </div>
              <span className="text-xs uppercase tracking-wide text-slate-400">{a.status.replace("_", " ")}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {NEXT_STATUSES[a.status].map((next) => (
                <button
                  key={next}
                  onClick={() => void setStatus(a, next)}
                  disabled={statusBusyId === a.id}
                  className="rounded-md bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-40"
                >
                  {next === "IN_PROGRESS" ? "Start" : next.charAt(0) + next.slice(1).toLowerCase().replace("_", " ")}
                </button>
              ))}
              {(a.status === "IN_PROGRESS" || a.status === "COMPLETED") && (
                <button
                  onClick={() => openCheckout(a)}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold hover:bg-blue-500"
                >
                  Checkout
                </button>
              )}
            </div>
          </div>
        ))}
        {sorted.length === 0 && !loadError && <p className="text-center text-slate-400">No bookings today.</p>}
      </div>

      {newOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-slate-800 p-6">
            <h2 className="text-xl font-bold">New booking</h2>
            <select
              value={newResourceId}
              onChange={(e) => setNewResourceId(e.target.value)}
              className="mt-4 w-full rounded-md border border-slate-600 bg-slate-900 p-3"
            >
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <input
              className="mt-3 w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              placeholder="Service name"
              value={newServiceName}
              onChange={(e) => setNewServiceName(e.target.value)}
            />
            {newCustomer ? (
              <div className="mt-3 flex items-center justify-between rounded-md bg-slate-900 p-2 text-sm">
                <span>{newCustomer.name}</span>
                <button onClick={() => setNewCustomer(null)} className="text-xs text-red-400">
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => openCustomerPicker("new")}
                className="mt-3 w-full rounded-md border border-dashed border-slate-700 p-2 text-sm text-slate-400 hover:border-slate-500"
              >
                + Attach customer (optional)
              </button>
            )}
            <label className="mt-3 block text-xs text-slate-400">Start</label>
            <input
              type="datetime-local"
              className="w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
            <label className="mt-3 block text-xs text-slate-400">End</label>
            <input
              type="datetime-local"
              className="w-full rounded-md border border-slate-600 bg-slate-900 p-3"
              value={newEnd}
              min={newStart}
              onChange={(e) => setNewEnd(e.target.value)}
            />
            {newError && <p className="mt-2 text-sm text-red-400">{newError}</p>}
            <div className="mt-4 flex gap-3">
              <button onClick={() => setNewOpen(false)} className="flex-1 rounded-md bg-slate-700 p-3">
                Cancel
              </button>
              <button
                onClick={() => void createAppointment()}
                disabled={newBusy || !newResourceId || !newServiceName.trim() || !newStart || !newEnd}
                className="flex-1 rounded-md bg-blue-600 p-3 font-semibold disabled:opacity-40"
              >
                {newBusy ? "Booking..." : "Book"}
              </button>
            </div>
          </div>
        </div>
      )}

      {customerPickerFor && (
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
                  onClick={() => selectCustomer(c)}
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
                setCustomerPickerFor(null);
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
    </div>
  );
}
