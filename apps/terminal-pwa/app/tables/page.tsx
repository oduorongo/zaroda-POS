"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db, getActiveSession, getDeviceConfig, type CachedVariant, type CashierSession, type DeviceConfig } from "../../lib/db";
import { apiGet, apiPatch, apiPost, ApiError, OfflineError } from "../../lib/api";

interface RestaurantTable {
  id: string;
  branchId: string;
  label: string;
  seats: number;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED" | "NEEDS_CLEANING";
}

interface KitchenStation {
  id: string;
  branchId: string;
  name: string;
}

interface TableOrderLine {
  variant: CachedVariant;
  quantity: number;
  stationId: string;
  courseNumber: number;
}

const STATUS_COLOR: Record<RestaurantTable["status"], string> = {
  AVAILABLE: "bg-green-900 hover:bg-green-800",
  OCCUPIED: "bg-amber-900 hover:bg-amber-800",
  RESERVED: "bg-blue-900 hover:bg-blue-800",
  NEEDS_CLEANING: "bg-red-900 hover:bg-red-800",
};

/**
 * A dine-in floor view + order builder, on top of the same core POS
 * capability (SalesService.create() underneath) that the plain cash
 * checkout screen uses - see RestaurantSalesService.createForTable().
 * Deliberately online-only (no outbox queueing): a table order needs to
 * actually reach the kitchen to be useful, unlike a retail cash sale
 * which is genuinely fine queued and synced later.
 */
export default function TablesPage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [variants, setVariants] = useState<CachedVariant[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTable, setActiveTable] = useState<RestaurantTable | null>(null);
  const [order, setOrder] = useState<TableOrderLine[]>([]);
  const [search, setSearch] = useState("");
  const [stationId, setStationId] = useState("");
  const [courseNumber, setCourseNumber] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [tendered, setTendered] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // Held (course > 1) items aren't sent to the kitchen until explicitly
  // fired (POST /sales/:saleId/courses/:courseNumber/fire) - tracked
  // in-memory only, keyed by table, since there's no "which sales still
  // have unfired courses" list endpoint to reconstruct this from after a
  // page reload. Consistent with the rest of this vertical being
  // online-only: losing this state on reload just means falling back to
  // firing the course from a raw API call, not losing the order itself.
  const [pendingCourses, setPendingCourses] = useState<Map<string, { saleId: string; courses: number[] }>>(new Map());
  const [firingKey, setFiringKey] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) return router.replace("/setup");
      const activeSession = await getActiveSession();
      if (!activeSession) return router.replace("/login");
      if (config.industryType !== "RESTAURANT") return router.replace("/pos");
      setDevice(config);
      setSession(activeSession);
      setVariants(await db.variants.toArray());
      await refresh(config, activeSession);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refresh(config: DeviceConfig, activeSession: CashierSession) {
    try {
      const [tableList, stationList] = await Promise.all([
        apiGet<RestaurantTable[]>(`/restaurant/tables?branchId=${config.branchId}`, activeSession.accessToken),
        apiGet<KitchenStation[]>(`/restaurant/stations?branchId=${config.branchId}`, activeSession.accessToken),
      ]);
      setTables(tableList);
      setStations(stationList);
      setStationId((prev) => prev || stationList[0]?.id || "");
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof OfflineError ? "Offline - the floor view needs a connection." : "Could not load tables.");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter((v) => v.productName.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q));
  }, [variants, search]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const { variant, quantity } of order) {
      const lineSubtotal = variant.price * quantity;
      subtotal += lineSubtotal;
      tax += lineSubtotal * variant.taxRate;
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [order]);

  function openTable(table: RestaurantTable) {
    setActiveTable(table);
    setOrder([]);
    setSubmitError(null);
  }

  function addToOrder(variant: CachedVariant) {
    if (!stationId) return;
    setOrder((prev) => {
      const idx = prev.findIndex(
        (l) => l.variant.id === variant.id && l.stationId === stationId && l.courseNumber === courseNumber,
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { variant, quantity: 1, stationId, courseNumber }];
    });
  }

  function setLineQuantity(index: number, quantity: number) {
    setOrder((prev) => {
      if (quantity <= 0) return prev.filter((_, i) => i !== index);
      const next = [...prev];
      next[index] = { ...next[index], quantity };
      return next;
    });
  }

  function stationName(id: string) {
    return stations.find((s) => s.id === id)?.name ?? "?";
  }

  async function submitOrder() {
    if (!device || !session || !activeTable || order.length === 0) return;
    const amount = Number(tendered);
    if (!Number.isFinite(amount) || amount < totals.total - 0.01) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await apiPost<{ sale: { id: string } }>(
        `/restaurant/tables/${activeTable.id}/sales`,
        {
          clientId: crypto.randomUUID(),
          terminalId: device.terminalId,
          cashierSessionId: session.cashierSessionId,
          lineItems: order.map((l) => ({
            variantId: l.variant.id,
            quantity: l.quantity,
            stationId: l.stationId,
            courseNumber: l.courseNumber,
          })),
          payments: [{ method: "CASH", amount: totals.total }],
        },
        session.accessToken,
      );

      const heldCourses = Array.from(new Set(order.filter((l) => l.courseNumber > 1).map((l) => l.courseNumber))).sort();
      if (heldCourses.length > 0) {
        setPendingCourses((prev) => new Map(prev).set(activeTable.id, { saleId: result.sale.id, courses: heldCourses }));
      }

      setToast(`Order sent to the kitchen - change due: ${Math.max(0, amount - totals.total).toFixed(2)}`);
      setTimeout(() => setToast(null), 4000);
      setActiveTable(null);
      setOrder([]);
      setCheckoutOpen(false);
      setTendered("");
      await refresh(device, session);
    } catch (err) {
      setSubmitError(
        err instanceof OfflineError
          ? "Offline - a table order needs a connection to reach the kitchen."
          : err instanceof ApiError
            ? err.message
            : "Order failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function markAvailable(table: RestaurantTable) {
    if (!session) return;
    await apiPatch(`/restaurant/tables/${table.id}/status`, { status: "AVAILABLE" }, session.accessToken);
    if (device && session) await refresh(device, session);
  }

  async function fireCourse(tableId: string, saleId: string, course: number) {
    if (!session) return;
    const key = `${saleId}::${course}`;
    setFiringKey(key);
    try {
      await apiPost(`/restaurant/sales/${saleId}/courses/${course}/fire`, {}, session.accessToken);
      setPendingCourses((prev) => {
        const next = new Map(prev);
        const entry = next.get(tableId);
        if (!entry) return next;
        const remaining = entry.courses.filter((c) => c !== course);
        if (remaining.length === 0) next.delete(tableId);
        else next.set(tableId, { ...entry, courses: remaining });
        return next;
      });
    } catch {
      setLoadError(`Could not fire course ${course} - try again.`);
    } finally {
      setFiringKey(null);
    }
  }

  if (!device || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
        <p>Loading...</p>
      </div>
    );
  }

  if (activeTable) {
    return (
      <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
        <header className="flex items-center justify-between border-b border-slate-800 p-3">
          <button onClick={() => setActiveTable(null)} className="text-blue-400">
            &larr; Floor
          </button>
          <p className="font-semibold">{activeTable.label}</p>
          <span className="w-16" />
        </header>

        {toast && <div className="bg-green-800 p-2 text-center text-sm">{toast}</div>}
        {submitError && <div className="bg-red-900 p-2 text-center text-sm">{submitError}</div>}

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden p-3">
            <div className="mb-3 flex gap-2">
              <select
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
                className="flex-1 rounded-md border border-slate-700 bg-slate-800 p-2.5"
              >
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={courseNumber}
                onChange={(e) => setCourseNumber(Number(e.target.value))}
                className="w-32 rounded-md border border-slate-700 bg-slate-800 p-2.5"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    Course {n}
                  </option>
                ))}
              </select>
            </div>
            <input
              className="mb-3 rounded-md border border-slate-700 bg-slate-800 p-2.5"
              placeholder="Search menu item..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
              {filtered.map((variant) => (
                <button
                  key={variant.id}
                  onClick={() => addToOrder(variant)}
                  disabled={!stationId}
                  className="flex flex-col items-start rounded-lg bg-slate-800 p-3 text-left hover:bg-slate-700 disabled:opacity-40"
                >
                  <span className="font-medium">{variant.productName}</span>
                  <span className="mt-1 font-mono text-lg font-bold text-blue-400">KES {variant.price.toFixed(2)}</span>
                </button>
              ))}
              {stations.length === 0 && <p className="col-span-full text-center text-slate-400">No kitchen stations set up yet.</p>}
            </div>
          </div>

          <div className="flex w-80 flex-col border-l border-slate-800 p-3">
            <h2 className="font-semibold">Order</h2>
            <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
              {order.map((line, i) => (
                <div key={i} className="rounded-md bg-slate-800 p-2">
                  <p className="text-sm font-medium">{line.variant.productName}</p>
                  <p className="text-xs text-slate-400">
                    {stationName(line.stationId)} · Course {line.courseNumber}
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setLineQuantity(i, line.quantity - 1)} className="h-7 w-7 rounded bg-slate-700">
                        -
                      </button>
                      <span className="w-6 text-center">{line.quantity}</span>
                      <button onClick={() => setLineQuantity(i, line.quantity + 1)} className="h-7 w-7 rounded bg-slate-700">
                        +
                      </button>
                    </div>
                    <span className="font-mono">KES {(line.variant.price * line.quantity).toFixed(2)}</span>
                  </div>
                </div>
              ))}
              {order.length === 0 && <p className="text-sm text-slate-500">No items yet.</p>}
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
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>KES {totals.total.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={() => setCheckoutOpen(true)}
              disabled={order.length === 0 || submitting}
              className="mt-3 w-full rounded-md bg-blue-600 p-3 font-semibold hover:bg-blue-500 disabled:opacity-40"
            >
              Send &amp; charge (Cash)
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
              <div className="mt-4 flex gap-3">
                <button onClick={() => setCheckoutOpen(false)} className="flex-1 rounded-md bg-slate-700 p-3">
                  Cancel
                </button>
                <button
                  onClick={submitOrder}
                  disabled={submitting || !Number.isFinite(Number(tendered)) || Number(tendered) < totals.total - 0.01}
                  className="flex-1 rounded-md bg-blue-600 p-3 font-semibold disabled:opacity-40"
                >
                  {submitting ? "Sending..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 p-3">
        <button onClick={() => router.push("/pos")} className="text-blue-400">
          &larr; POS
        </button>
        <p className="font-semibold">Floor</p>
        <span className="w-16" />
      </header>
      {loadError && <div className="bg-red-900 p-2 text-center text-sm">{loadError}</div>}
      <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-3 sm:grid-cols-4">
        {tables.map((table) => (
          <div key={table.id} className={`flex flex-col items-center gap-1 rounded-lg p-4 text-center ${STATUS_COLOR[table.status]}`}>
            <button onClick={() => openTable(table)} className="flex flex-col items-center gap-1">
              <span className="text-lg font-bold">{table.label}</span>
              <span className="text-xs">{table.seats} seats</span>
              <span className="text-xs uppercase tracking-wide">{table.status.replace("_", " ")}</span>
            </button>
            {table.status === "NEEDS_CLEANING" && (
              <button onClick={() => void markAvailable(table)} className="mt-1 rounded bg-slate-900/50 px-2 py-1 text-xs hover:bg-slate-900">
                Mark clean
              </button>
            )}
            {pendingCourses.get(table.id)?.courses.map((course) => {
              const entry = pendingCourses.get(table.id)!;
              const key = `${entry.saleId}::${course}`;
              return (
                <button
                  key={course}
                  onClick={() => void fireCourse(table.id, entry.saleId, course)}
                  disabled={firingKey === key}
                  className="mt-1 rounded bg-amber-700 px-2 py-1 text-xs hover:bg-amber-600 disabled:opacity-40"
                >
                  {firingKey === key ? "Firing..." : `Fire course ${course}`}
                </button>
              );
            })}
          </div>
        ))}
        {tables.length === 0 && !loadError && <p className="col-span-full text-center text-slate-400">No tables set up for this branch yet.</p>}
      </div>
    </div>
  );
}
