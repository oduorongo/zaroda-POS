"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db, getActiveSession, getDeviceConfig, type CachedVariant, type CashierSession, type DeviceConfig } from "../../lib/db";
import { apiGet, apiPost, ApiError, OfflineError } from "../../lib/api";
import { isSupervisor, kes, printBill, roleOf, shareBill, type Bill, type HeldCourse, type Tab } from "../../lib/tabs";
import TabPaySheet from "../../components/tab-pay-sheet";

type TableStatus = "AVAILABLE" | "OCCUPIED" | "RESERVED" | "NEEDS_CLEANING";

interface RestaurantTable {
  id: string;
  branchId: string;
  label: string;
  seats: number;
  status: TableStatus;
  reservation: { guestName: string; time: string } | null;
  tab: { id: string; openedAt: string; guestCount: number; itemCount: number; total: number } | null;
}

interface KitchenStation {
  id: string;
  name: string;
}

interface DraftLine {
  variant: CachedVariant;
  quantity: number;
  stationId: string; // "" = the dish's own station (chosen by the server)
  courseNumber: number;
  notes: string;
}

const STATUS_COLOR: Record<TableStatus, string> = {
  AVAILABLE: "bg-green-900 hover:bg-green-800",
  OCCUPIED: "bg-amber-900 hover:bg-amber-800",
  RESERVED: "bg-primary-900 hover:bg-primary-800",
  NEEDS_CLEANING: "bg-red-900 hover:bg-red-800",
};
const STATUS_LABEL: Record<TableStatus, string> = { AVAILABLE: "Free", OCCUPIED: "Occupied", RESERVED: "Reserved", NEEDS_CLEANING: "Needs cleaning" };
const LINE_BADGE: Record<string, string> = { ORDERED: "", PAID: "Paid", VOIDED: "Voided" };
const input = "rounded-md border border-slate-700 bg-slate-800 p-2.5";

const explain = (err: unknown, fallback: string) => (err instanceof OfflineError ? "Offline - the floor needs a connection." : err instanceof ApiError ? err.message : fallback);

/**
 * The restaurant floor and open bills. A table is opened with a bill; items are added as the diners order and go to the kitchen
 * at once (later courses wait until fired); the bill is paid at the end - all of it, in parts, or split. Online-only: the
 * kitchen and the shared bill must be live (a quick counter sale is still done on the normal Sales screen).
 */
export default function TablesPage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [held, setHeld] = useState<Record<string, HeldCourse[]>>({});
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [variants, setVariants] = useState<CachedVariant[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [activeTable, setActiveTable] = useState<RestaurantTable | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [tabLoaded, setTabLoaded] = useState(false);
  const [guests, setGuests] = useState("2");
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [search, setSearch] = useState("");
  const [stationId, setStationId] = useState("");
  const [courseNumber, setCourseNumber] = useState(1);
  const [tabHeld, setTabHeld] = useState<HeldCourse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [bill, setBill] = useState<Bill | null>(null);
  const [splitPreview, setSplitPreview] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);

  const role = useMemo(() => (session ? roleOf(session.accessToken) : ""), [session]);
  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const refreshFloor = useCallback(async (config: DeviceConfig, active: CashierSession) => {
    try {
      const [tableList, stationList] = await Promise.all([
        apiGet<RestaurantTable[]>(`/restaurant/tables?branchId=${config.branchId}`, active.accessToken),
        apiGet<KitchenStation[]>(`/restaurant/stations?branchId=${config.branchId}`, active.accessToken),
      ]);
      setTables(tableList);
      setStations(stationList);
      setLoadError(null);
      // courses still waiting to be fired come from the server, so they are still there after a refresh
      const busyTables = tableList.filter((t) => t.status === "OCCUPIED" || t.status === "NEEDS_CLEANING");
      const lists = await Promise.all(busyTables.map((t) => apiGet<HeldCourse[]>(`/restaurant/tables/${t.id}/held-courses`, active.accessToken).catch(() => [] as HeldCourse[])));
      setHeld(Object.fromEntries(busyTables.map((t, i) => [t.id, lists[i]]).filter(([, l]) => (l as HeldCourse[]).length > 0)));
    } catch (err) {
      setLoadError(explain(err, "Could not load tables."));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) return router.replace("/setup");
      const active = await getActiveSession();
      if (!active) return router.replace("/login");
      if (config.industryType !== "RESTAURANT" && config.industryType !== "HOTEL") return router.replace("/pos");
      setDevice(config);
      setSession(active);
      setVariants(await db.variants.toArray());
      await refreshFloor(config, active);
    })();
  }, [router, refreshFloor]);

  // The floor and an open bill refresh by themselves, so what another till does shows up here.
  const activeId = activeTable?.id ?? null;
  const loadTab = useCallback(
    async (tableId: string) => {
      if (!session) return;
      try {
        const [found, heldList] = await Promise.all([
          apiGet<Tab | Record<string, never>>(`/restaurant/tables/${tableId}/tab`, session.accessToken),
          apiGet<HeldCourse[]>(`/restaurant/tables/${tableId}/held-courses`, session.accessToken),
        ]);
        setTab("id" in found ? (found as Tab) : null);
        setTabHeld(heldList);
        setTabLoaded(true);
      } catch (err) {
        setError(explain(err, "Could not load the bill."));
      }
    },
    [session],
  );

  useEffect(() => {
    if (!device || !session) return;
    const timer = setInterval(() => {
      if (payOpen || busy) return;
      if (activeId) void loadTab(activeId);
      else void refreshFloor(device, session);
    }, 8000);
    return () => clearInterval(timer);
  }, [device, session, activeId, payOpen, busy, loadTab, refreshFloor]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? variants.filter((v) => v.productName.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q)) : variants;
  }, [variants, search]);

  const draftTotal = useMemo(() => draft.reduce((s, l) => s + l.variant.price * l.quantity * (1 + l.variant.taxRate), 0), [draft]);
  const stationName = (id: string) => stations.find((s) => s.id === id)?.name;

  async function openTable(table: RestaurantTable) {
    setActiveTable(table);
    setTab(null);
    setTabLoaded(false);
    setDraft([]);
    setError(null);
    setGuests(String(Math.min(table.seats, 2) || 1));
    await loadTab(table.id);
  }

  function closeTable() {
    setActiveTable(null);
    setTab(null);
    setDraft([]);
    setPayOpen(false);
    setBill(null);
    if (device && session) void refreshFloor(device, session);
  }

  async function run<T>(task: () => Promise<T>, fallback: string): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await task();
    } catch (err) {
      setError(explain(err, fallback));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function openBill() {
    if (!session || !activeTable) return;
    const result = await run(() => apiPost<Tab>(`/restaurant/tables/${activeTable.id}/tabs`, { guestCount: Math.max(1, Math.round(Number(guests)) || 1) }, session.accessToken), "Could not open the bill.");
    if (result) {
      setTab(result);
      setTabLoaded(true);
    }
  }

  function addToDraft(variant: CachedVariant) {
    setDraft((prev) => {
      const i = prev.findIndex((l) => l.variant.id === variant.id && l.stationId === stationId && l.courseNumber === courseNumber && !l.notes);
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { variant, quantity: 1, stationId, courseNumber, notes: "" }];
    });
  }

  async function sendToKitchen() {
    if (!session || !tab || draft.length === 0) return;
    const result = await run(
      () =>
        apiPost<Tab>(
          `/restaurant/tabs/${tab.id}/lines`,
          { lines: draft.map((l) => ({ variantId: l.variant.id, quantity: l.quantity, stationId: l.stationId || undefined, courseNumber: l.courseNumber, notes: l.notes.trim() || undefined })) },
          session.accessToken,
        ),
      "Could not send the items.",
    );
    if (result) {
      setTab(result);
      setDraft([]);
      flash("Sent. Course 1 is with the kitchen now.");
      if (activeTable) void loadTab(activeTable.id);
    }
  }

  async function voidLine(lineId: string, title: string) {
    if (!session || !tab) return;
    const reason = window.prompt(`Why is "${title}" being voided? (the kitchen will see it struck through)`);
    if (!reason || reason.trim().length < 3) return;
    const result = await run(() => apiPost<Tab>(`/restaurant/tabs/${tab.id}/lines/${lineId}/void`, { reason: reason.trim() }, session.accessToken), "Could not void that item.");
    if (result) setTab(result);
  }

  async function fire(course: HeldCourse) {
    if (!session) return;
    const path = course.source === "TAB" ? `/restaurant/tabs/${course.tabId}/courses/${course.courseNumber}/fire` : `/restaurant/sales/${course.saleId}/courses/${course.courseNumber}/fire`;
    const ok = await run(() => apiPost(path, {}, session.accessToken), `Could not fire course ${course.courseNumber}.`);
    if (ok !== undefined) {
      flash(`Course ${course.courseNumber} sent to the kitchen.`);
      if (activeTable) await loadTab(activeTable.id);
      else if (device) await refreshFloor(device, session);
    }
  }

  async function showBill(split?: number) {
    if (!session || !tab) return;
    const result = await run(() => apiGet<Bill>(`/restaurant/tabs/${tab.id}/bill${split ? `?split=${split}` : ""}`, session.accessToken), "Could not make the bill.");
    if (result) setBill(result);
  }

  async function moveTo(target: RestaurantTable) {
    if (!session || !tab) return;
    const result = await run(() => apiPost<Tab>(`/restaurant/tabs/${tab.id}/move`, { tableId: target.id }, session.accessToken), "Could not move the bill.");
    if (result) {
      setMoveOpen(false);
      setTab(result);
      setActiveTable(target);
      flash(`Moved to ${target.label}.`);
    }
  }

  async function cancelBill() {
    if (!session || !tab) return;
    const hasItems = tab.lines.some((l) => l.status === "ORDERED");
    let reason: string | undefined;
    if (hasItems) {
      const r = window.prompt("This bill has items on it. Why is it being thrown away?");
      if (!r || r.trim().length < 3) return;
      reason = r.trim();
    } else if (!window.confirm("Close this empty bill?")) return;
    const result = await run(() => apiPost<Tab>(`/restaurant/tabs/${tab.id}/cancel`, { reason }, session.accessToken), "Could not close the bill.");
    if (result) {
      flash("Bill closed.");
      closeTable();
    }
  }

  async function markClean(table: RestaurantTable) {
    if (!device || !session) return;
    try {
      await apiPost(`/restaurant/tables/${table.id}/clean`, {}, session.accessToken);
      await refreshFloor(device, session);
    } catch (err) {
      setLoadError(explain(err, "Could not mark the table clean."));
    }
  }

  if (!device || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
        <p>Loading...</p>
      </div>
    );
  }

  // ── One table ──
  if (activeTable) {
    const open = tab?.status === "OPEN" ? tab : null;
    const freeTables = tables.filter((t) => t.id !== activeTable.id && !t.tab && (t.status === "AVAILABLE" || t.status === "NEEDS_CLEANING" || t.status === "RESERVED"));
    return (
      <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
        <header className="flex items-center justify-between border-b border-slate-800 p-3">
          <button onClick={closeTable} className="text-primary-400">
            &larr; Floor
          </button>
          <p className="font-semibold">
            {activeTable.label}
            {open ? ` · ${open.guestCount} guest${open.guestCount === 1 ? "" : "s"}` : ""}
          </p>
          {open ? (
            <button onClick={() => setMoveOpen(true)} className="text-sm text-primary-400">
              Move table
            </button>
          ) : (
            <span className="w-16" />
          )}
        </header>

        {toast && <div className="bg-green-800 p-2 text-center text-sm">{toast}</div>}
        {error && <div className="bg-red-900 p-2 text-center text-sm">{error}</div>}

        {!tabLoaded && <p className="p-6 text-center text-slate-400">Loading...</p>}

        {tabLoaded && !open && (
          <div className="mx-auto mt-10 w-full max-w-sm space-y-4 p-4 text-center">
            <h2 className="text-xl font-bold">{activeTable.label} has no bill yet</h2>
            {activeTable.status === "RESERVED" && activeTable.reservation && (
              <p className="text-sm text-primary-300">
                Reserved for {activeTable.reservation.guestName} at {activeTable.reservation.time}.
              </p>
            )}
            <label className="block text-left text-sm">
              How many guests?
              <input type="number" min={1} max={100} className={`${input} mt-1 w-full`} value={guests} onChange={(e) => setGuests(e.target.value)} />
            </label>
            <button onClick={() => void openBill()} disabled={busy} className="w-full rounded-md bg-primary-600 p-3 font-semibold hover:bg-primary-500 disabled:opacity-40">
              {busy ? "Opening..." : "Open a bill"}
            </button>
          </div>
        )}

        {open && (
          <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
            {/* Menu and what is about to be sent */}
            <div className="flex flex-1 flex-col overflow-hidden p-3">
              <div className="mb-3 flex gap-2">
                <select value={stationId} onChange={(e) => setStationId(e.target.value)} className={`${input} flex-1`}>
                  <option value="">Station: automatic</option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select value={courseNumber} onChange={(e) => setCourseNumber(Number(e.target.value))} className={`${input} w-36`}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "Course 1 (now)" : `Course ${n} (hold)`}
                    </option>
                  ))}
                </select>
              </div>
              <input className={`${input} mb-3`} placeholder="Search menu item..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                {filtered.map((v) => (
                  <button key={v.id} onClick={() => addToDraft(v)} className="flex flex-col items-start rounded-lg bg-slate-800 p-3 text-left hover:bg-slate-700">
                    <span className="font-medium">{v.productName}</span>
                    <span className="mt-1 font-mono text-lg font-bold text-primary-400">{kes(v.price)}</span>
                  </button>
                ))}
                {stations.length === 0 && <p className="col-span-full text-center text-slate-400">No kitchen stations set up yet - add one in the back office under Tables &amp; Kitchen.</p>}
              </div>

              {draft.length > 0 && (
                <div className="mt-3 space-y-2 rounded-lg border border-primary-700 bg-slate-800 p-3">
                  <p className="text-sm font-semibold">To send to the kitchen</p>
                  {draft.map((l, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="flex-1">
                        {l.quantity} x {l.variant.productName}
                        <span className="ml-1 text-xs text-slate-400">
                          {l.stationId ? stationName(l.stationId) : "auto"} · course {l.courseNumber}
                        </span>
                      </span>
                      <input
                        className="w-32 rounded border border-slate-600 bg-slate-900 p-1 text-xs"
                        placeholder="Note (no onions)"
                        value={l.notes}
                        maxLength={200}
                        onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                      />
                      <button onClick={() => setDraft((d) => d.map((x, j) => (j === i ? { ...x, quantity: x.quantity - 1 } : x)).filter((x) => x.quantity > 0))} className="h-7 w-7 rounded bg-slate-700">
                        -
                      </button>
                      <button onClick={() => setDraft((d) => d.map((x, j) => (j === i ? { ...x, quantity: x.quantity + 1 } : x)))} className="h-7 w-7 rounded bg-slate-700">
                        +
                      </button>
                    </div>
                  ))}
                  <button onClick={() => void sendToKitchen()} disabled={busy} className="w-full rounded-md bg-primary-600 p-3 font-semibold hover:bg-primary-500 disabled:opacity-40">
                    {busy ? "Sending..." : `Send to the kitchen (${kes(draftTotal)})`}
                  </button>
                </div>
              )}
            </div>

            {/* The bill */}
            <div className="flex max-h-[45vh] flex-col border-t border-slate-800 p-3 md:max-h-none md:w-96 md:border-l md:border-t-0">
              <h2 className="font-semibold">Bill</h2>
              <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
                {open.lines.length === 0 && <p className="text-sm text-slate-500">Nothing ordered yet.</p>}
                {open.lines.map((l) => (
                  <div key={l.id} className={`rounded-md bg-slate-800 p-2 ${l.status === "VOIDED" ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${l.status === "VOIDED" ? "line-through" : ""}`}>
                        {l.quantity} x {l.title}
                      </p>
                      <span className={`font-mono text-sm ${l.status === "VOIDED" ? "line-through" : ""}`}>{kes(l.amount)}</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {l.stationName} · course {l.courseNumber}
                      {l.notes ? ` · ${l.notes}` : ""}
                      {LINE_BADGE[l.status] ? ` · ${LINE_BADGE[l.status]}${l.voidReason ? `: ${l.voidReason}` : ""}` : ""}
                    </p>
                    {l.status === "ORDERED" && isSupervisor(role) && (
                      <button onClick={() => void voidLine(l.id, l.title)} className="mt-1 text-xs text-red-400 hover:underline">
                        Void
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {tabHeld.length > 0 && (
                <div className="mt-2 space-y-1">
                  {tabHeld.map((c) => (
                    <button key={`${c.tabId ?? c.saleId}-${c.courseNumber}`} onClick={() => void fire(c)} disabled={busy} className="w-full rounded bg-amber-700 p-2 text-left text-sm hover:bg-amber-600 disabled:opacity-40">
                      Fire course {c.courseNumber}
                      <span className="block text-xs text-amber-200">{c.items.map((i) => `${i.quantity} x ${i.title}`).join(", ")}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-sm">
                <div className="flex justify-between text-slate-400">
                  <span>Before VAT</span>
                  <span>{kes(open.subtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>VAT</span>
                  <span>{kes(open.tax)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span>To pay</span>
                  <span>{kes(open.total)}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => void showBill()} disabled={busy || open.unpaidCount === 0} className="rounded-md bg-slate-700 p-2.5 text-sm hover:bg-slate-600 disabled:opacity-40">
                  Show / print bill
                </button>
                <button onClick={() => setPayOpen(true)} disabled={busy || open.unpaidCount === 0} className="rounded-md bg-primary-600 p-2.5 font-semibold hover:bg-primary-500 disabled:opacity-40">
                  Pay
                </button>
              </div>
              {(isSupervisor(role) || open.lines.every((l) => l.status !== "ORDERED")) && open.lines.every((l) => l.status !== "PAID") && (
                <button onClick={() => void cancelBill()} disabled={busy} className="mt-2 text-xs text-red-400 hover:underline">
                  {open.lines.some((l) => l.status === "ORDERED") ? "Throw this bill away" : "Close this empty bill"}
                </button>
              )}
            </div>
          </div>
        )}

        {payOpen && open && (
          <TabPaySheet
            tab={open}
            token={session.accessToken}
            terminalId={device.terminalId}
            cashierSessionId={session.cashierSessionId}
            onClose={() => setPayOpen(false)}
            onDone={(message, closed) => {
              setPayOpen(false);
              flash(message);
              if (closed) closeTable();
              else void loadTab(activeTable.id);
            }}
          />
        )}

        {bill && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-sm rounded-xl bg-slate-800 p-5">
              <h2 className="text-lg font-bold">{bill.business}</h2>
              <p className="text-sm text-slate-400">{bill.table.label}</p>
              <div className="mt-3 space-y-1 text-sm">
                {bill.lines.map((l) => (
                  <div key={l.id} className="flex justify-between gap-2">
                    <span>
                      {l.quantity} x {l.title}
                    </span>
                    <span className="font-mono">{l.amount.toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-600 pt-1 text-slate-400">
                  <span>VAT</span>
                  <span>{bill.tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>{kes(bill.total)}</span>
                </div>
                {bill.split && <p className="text-primary-300">Split {bill.split.length} ways: {kes(bill.split[0])} each</p>}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <label className="flex-1 text-sm">
                  Split equally between
                  <input type="number" min={2} max={50} className={`${input} mt-1 w-full`} value={splitPreview} onChange={(e) => setSplitPreview(e.target.value)} placeholder="people" />
                </label>
                <button onClick={() => void showBill(Math.round(Number(splitPreview)) >= 2 ? Math.round(Number(splitPreview)) : undefined)} className="rounded-md bg-slate-700 px-3 py-2.5 text-sm">
                  Show
                </button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button onClick={() => printBill(bill)} className="rounded-md bg-primary-600 p-2.5 text-sm font-semibold">
                  Print
                </button>
                <button onClick={() => void shareBill(bill).then(flash)} className="rounded-md bg-slate-700 p-2.5 text-sm">
                  Share
                </button>
                <button onClick={() => setBill(null)} className="rounded-md bg-slate-700 p-2.5 text-sm">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {moveOpen && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl bg-slate-800 p-5">
              <h2 className="text-lg font-bold">Move the bill to...</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {freeTables.map((t) => (
                  <button key={t.id} onClick={() => void moveTo(t)} disabled={busy} className="rounded-md bg-slate-700 p-3 hover:bg-slate-600 disabled:opacity-40">
                    {t.label}
                    <span className="block text-xs text-slate-400">{STATUS_LABEL[t.status]}</span>
                  </button>
                ))}
                {freeTables.length === 0 && <p className="col-span-2 text-sm text-slate-400">No free table to move to.</p>}
              </div>
              <button onClick={() => setMoveOpen(false)} className="mt-4 w-full rounded-md bg-slate-700 p-2.5">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── The floor ──
  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 p-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-primary-400">
            &larr; Back
          </button>
          <button onClick={() => router.push("/pos")} className="text-primary-400">
            Home
          </button>
        </div>
        <p className="font-semibold">Floor</p>
        <span className="w-16" />
      </header>
      {loadError && <div className="bg-red-900 p-2 text-center text-sm">{loadError}</div>}
      {toast && <div className="bg-green-800 p-2 text-center text-sm">{toast}</div>}
      <div className="grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-3 sm:grid-cols-4">
        {tables.map((table) => (
          <div key={table.id} className={`flex flex-col items-center gap-1 rounded-lg p-4 text-center ${STATUS_COLOR[table.status]}`}>
            <button onClick={() => void openTable(table)} className="flex flex-col items-center gap-1">
              <span className="text-lg font-bold">{table.label}</span>
              <span className="text-xs">{table.seats} seats</span>
              <span className="text-xs uppercase tracking-wide">{STATUS_LABEL[table.status]}</span>
              {table.tab && (
                <span className="font-mono text-sm font-bold">
                  {kes(table.tab.total)} <span className="text-xs font-normal">· {table.tab.itemCount} items</span>
                </span>
              )}
              {table.status === "RESERVED" && table.reservation && (
                <span className="text-xs">
                  {table.reservation.guestName} at {table.reservation.time}
                </span>
              )}
            </button>
            {table.status === "NEEDS_CLEANING" && (
              <button onClick={() => void markClean(table)} className="mt-1 rounded bg-slate-900/50 px-2 py-1 text-xs hover:bg-slate-900">
                Mark clean
              </button>
            )}
            {(held[table.id] ?? []).map((c) => (
              <button key={`${c.tabId ?? c.saleId}-${c.courseNumber}`} onClick={() => void fire(c)} disabled={busy} className="mt-1 rounded bg-amber-700 px-2 py-1 text-xs hover:bg-amber-600 disabled:opacity-40">
                Fire course {c.courseNumber}
              </button>
            ))}
          </div>
        ))}
        {tables.length === 0 && !loadError && <p className="col-span-full text-center text-slate-400">No tables set up for this branch yet.</p>}
      </div>
    </div>
  );
}
