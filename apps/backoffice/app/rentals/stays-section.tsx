"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from "../../lib/api";
import { downloadCsv } from "../../lib/csv-download";

type Source = "DIRECT" | "AIRBNB" | "BOOKING_COM" | "OTHER";
type Status = "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" | "NO_SHOW";

interface Feed { id: string; source: Source; url: string; lastSyncedAt: string | null; lastError: string | null; eventCount: number }
interface ShortStay {
  active: boolean; nightlyRate: number; weekendRate: number | null; minNights: number; maxGuests: number; cleaningFee: number;
  checkInTime: string; checkOutTime: string; directions: string | null; doorCode: string | null; cleanerName: string | null; cleanerPhone: string | null;
  ownerId: string | null; owner: string | null; calendarUrl: string | null; calendarUrls: { AIRBNB: string | null; BOOKING_COM: string | null }; feeds: Feed[];
}
interface StayUnitRow { unitId: string; label: string; property: string; propertyId: string; unitStatus: "VACANT" | "OCCUPIED"; shortStay: ShortStay | null }
interface Payment { id: string; kind: "PAYMENT" | "REFUND"; amount: number; method: string; reference: string | null; paidAt: string; receiptNumber: string; note: string | null; voided: boolean; voidReason: string | null }
interface Stay {
  id: string; code: string; unitId: string; unit: string; property: string; source: Source; sourceLabel: string; externalRef: string | null;
  guestName: string; guestPhone: string | null; guestEmail: string | null; guests: number; checkIn: string; checkOut: string; nights: number;
  accommodation: number; cleaningFee: number; channelFee: number; total: number; paid: number; balance: number; status: Status; notes: string | null; cancelReason: string | null; payments: Payment[];
}
interface CalStay { id: string; code: string; guestName: string; source: Source; status: Status; checkIn: string; checkOut: string; balance: number }
interface CalBlock { id: string; source: string; startDate: string; endDate: string; summary: string | null; manual: boolean; clash: boolean }
interface Calendar { from: string; to: string; units: { unitId: string; label: string; property: string; stays: CalStay[]; blocks: CalBlock[]; cleaningsDue: string[] }[] }
interface Cleaning { id: string; unitId: string; unit: string; property: string; dueDate: string; overdue: boolean; status: "PENDING" | "DONE"; stay: { code: string; guestName: string; guestLeft: boolean } | null; nextArrival: string | null; cleanerName: string | null; cleanerPhone: string | null; notes: string | null }
interface Owner { id: string; name: string; phone: string | null; email: string | null; commissionPercent: number; notes: string | null; units: number }
interface StatementLine { unit: string; property: string; stays: number; nights: number; occupancyPercent: number; accommodation: number; cleaning: number; channelFees: number; net: number; commission: number; expenses: number; payable: number }
interface Statement { month: string; owners: { ownerId: string | null; owner: string; commissionPercent: number; lines: StatementLine[]; totals: Omit<StatementLine, "unit" | "property" | "stays" | "occupancyPercent"> }[] }

const NAVY = "#0f1f45";
const GOLD = "#d4af37";
const ORANGE = "#f5820a";
const SOURCE_COLOUR: Record<string, string> = { DIRECT: NAVY, AIRBNB: ORANGE, BOOKING_COM: GOLD, OTHER: "#64748b", MANUAL: "#94a3b8" };
const SOURCE_LABEL: Record<string, string> = { DIRECT: "Direct", AIRBNB: "Airbnb", BOOKING_COM: "Booking.com", OTHER: "Other site", MANUAL: "Blocked" };
const STATUS_LABEL: Record<Status, string> = { CONFIRMED: "Booked", CHECKED_IN: "In", CHECKED_OUT: "Left", CANCELLED: "Cancelled", NO_SHOW: "No-show" };
const METHODS = [["CASH", "Cash"], ["MPESA", "M-Pesa"], ["BANK", "Bank"], ["CARD", "Card"], ["CHANNEL", "Paid out by Airbnb / Booking.com"], ["OTHER", "Other"]];

const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const small = "rounded border border-border px-2 py-1 text-xs hover:bg-background disabled:opacity-50";
const money = (v: number) => v.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const DAY = 86_400_000;
const todayIso = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function errText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-secondary-500">{label}</span>
      {children}
    </label>
  );
}

function Messages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md p-3 text-sm text-white" style={{ background: NAVY, borderLeft: `4px solid ${GOLD}` }}>{notice}</p>}
    </>
  );
}

type Sub = "calendar" | "bookings" | "cleaning" | "units" | "owners";

/** Short stays: Airbnb-style nightly lets inside ZARODA RENTALS. */
export function StaysSection({ caretaker }: { caretaker: boolean }) {
  const [sub, setSub] = useState<Sub>("calendar");
  const [units, setUnits] = useState<StayUnitRow[]>([]);
  const [openStay, setOpenStay] = useState<string | null>(null);
  const [newFor, setNewFor] = useState<{ unitId: string; checkIn: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);

  const loadUnits = useCallback(async () => {
    try {
      setUnits(await apiGet<StayUnitRow[]>("/rental/stays/units"));
    } catch (e) {
      setError(errText(e, "Could not load your units."));
    }
  }, []);
  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  const stayUnits = units.filter((u) => u.shortStay?.active);
  const subs: [Sub, string][] = [["calendar", "Calendar"], ["bookings", "Bookings"], ["cleaning", "Cleaning"], ...(caretaker ? [] : ([["units", "Units & calendars"], ["owners", "Owners & statements"]] as [Sub, string][]))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {subs.map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} className="rounded-md border px-3 py-1.5 text-sm" style={sub === k ? { background: NAVY, color: "white", borderColor: NAVY } : { borderColor: "var(--color-border, #cbd5e1)" }}>
            {label}
          </button>
        ))}
      </div>
      <Messages error={error} notice={null} />
      {upgrade && <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">Short stays come with the Starter plan or Pay-as-you-collect. Open the Plan tab to move up.</p>}
      {stayUnits.length === 0 && sub !== "units" && sub !== "owners" && (
        <p className="rounded-md border border-border bg-surface p-3 text-sm">
          No unit is let by the night yet. {caretaker ? "Ask the landlord to set one up." : <>Open <button className="underline" onClick={() => setSub("units")}>Units & calendars</button> and set a nightly rate on a vacant unit.</>}
        </p>
      )}
      {sub === "calendar" && <CalendarView onOpen={setOpenStay} onNew={(unitId, checkIn) => setNewFor({ unitId, checkIn })} canBlock />}
      {sub === "bookings" && <BookingsView onOpen={setOpenStay} onNew={() => setNewFor({ unitId: stayUnits[0]?.unitId ?? "", checkIn: todayIso() })} />}
      {sub === "cleaning" && <CleaningView units={stayUnits} />}
      {sub === "units" && !caretaker && <UnitsView units={units} reload={loadUnits} onUpgrade={() => setUpgrade(true)} />}
      {sub === "owners" && !caretaker && <OwnersView />}
      {newFor && stayUnits.length > 0 && (
        <Modal title="New booking" onClose={() => setNewFor(null)}>
          <NewBooking units={stayUnits} initial={newFor} onDone={(id) => { setNewFor(null); setOpenStay(id); }} />
        </Modal>
      )}
      {openStay && (
        <Modal title="Booking" onClose={() => setOpenStay(null)}>
          <StayDetail id={openStay} caretaker={caretaker} />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-xl bg-surface p-4 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className={small} onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Calendar ──────────────────────────────────────────────────────────────

function CalendarView({ onOpen, onNew, canBlock }: { onOpen: (id: string) => void; onNew: (unitId: string, checkIn: string) => void; canBlock: boolean }) {
  const [from, setFrom] = useState(todayIso());
  const [cal, setCal] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = 21;
  const load = useCallback(async () => {
    try {
      setCal(await apiGet<Calendar>(`/rental/stays/calendar?from=${from}&days=${days}`));
    } catch (e) {
      setError(errText(e, "Could not load the calendar."));
    }
  }, [from]);
  useEffect(() => {
    void load();
  }, [load]);
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from]);

  async function block(unitId: string, start: string) {
    const nights = window.prompt(`Block how many nights from ${nice(start)}? (owner staying, repairs...)`, "1");
    if (!nights || !(Number(nights) > 0)) return;
    const summary = window.prompt("Why? (only you see this)", "Owner staying") ?? "Blocked";
    try {
      await apiPost("/rental/stays/blocks", { unitId, startDate: start, endDate: addDays(start, Number(nights)), summary });
      await load();
    } catch (e) {
      setError(errText(e, "Could not block those dates."));
    }
  }

  async function unblock(id: string) {
    if (!confirm("Free these dates?")) return;
    try {
      await apiDelete(`/rental/stays/blocks/${id}`);
      await load();
    } catch (e) {
      setError(errText(e, "Could not free those dates."));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={small} onClick={() => setFrom(addDays(from, -7))}>Back a week</button>
        <button className={small} onClick={() => setFrom(todayIso())}>Today</button>
        <button className={small} onClick={() => setFrom(addDays(from, 7))}>Next week</button>
        <input type="date" className="rounded-md border border-border bg-surface p-1 text-sm" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className="flex flex-wrap gap-2 text-xs">
          {Object.entries(SOURCE_LABEL).map(([k, l]) => (
            <span key={k} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: SOURCE_COLOUR[k] }} />{l}</span>
          ))}
        </span>
      </div>
      <Messages error={error} notice={null} />
      <p className="text-xs text-secondary-500">Tap an empty night to book it{canBlock ? " (or block it)" : ""}; tap a booking to open it. A red outline means an Airbnb or Booking.com booking clashes with one here.</p>
      {cal && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-28 bg-surface p-2 text-left">Unit</th>
                {dates.map((d) => (
                  <th key={d} className={`min-w-10 p-1 text-center font-normal ${d === todayIso() ? "font-bold" : ""}`}>{nice(d).replace(" ", "\n")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cal.units.map((u) => (
                <tr key={u.unitId} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-surface p-2">
                    <span className="font-semibold">{u.label}</span>
                    <span className="block text-[10px] text-secondary-500">{u.property}</span>
                  </td>
                  {dates.map((d) => {
                    const s = u.stays.find((x) => x.checkIn <= d && d < x.checkOut);
                    const b = !s && u.blocks.find((x) => x.startDate <= d && d < x.endDate);
                    const clash = u.blocks.some((x) => x.clash && x.startDate <= d && d < x.endDate);
                    const clean = u.cleaningsDue.includes(d);
                    if (s) {
                      const first = s.checkIn === d || d === from;
                      return (
                        <td key={d} className="p-0">
                          <button title={`${s.code} ${s.guestName} (${SOURCE_LABEL[s.source]}, ${STATUS_LABEL[s.status]})${s.balance > 0 ? ` - owes ${money(s.balance)}` : ""}`} onClick={() => onOpen(s.id)} className="block h-9 w-full truncate px-1 text-left text-[10px] text-white" style={{ background: SOURCE_COLOUR[s.source], opacity: s.status === "CHECKED_OUT" ? 0.55 : 1, outline: clash ? "2px solid #dc2626" : undefined }}>
                            {first ? s.guestName.split(" ")[0] : ""}{first && s.balance > 0 ? " •" : ""}
                          </button>
                        </td>
                      );
                    }
                    if (b) {
                      return (
                        <td key={d} className="p-0">
                          <button title={`${SOURCE_LABEL[b.source] ?? b.source}: ${b.summary ?? "Not available"}${b.manual ? " (tap to free)" : ""}`} onClick={() => (b.manual ? unblock(b.id) : undefined)} className="block h-9 w-full text-[10px] text-white" style={{ background: SOURCE_COLOUR[b.source] ?? "#94a3b8", backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 4px, transparent 4px 8px)" }}>
                            {b.startDate === d ? (SOURCE_LABEL[b.source] ?? "").slice(0, 3) : ""}
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td key={d} className="p-0">
                        <button
                          className="block h-9 w-full hover:bg-background"
                          title={clean ? "Cleaning due" : "Free"}
                          onClick={() => {
                            if (d < todayIso()) return;
                            if (canBlock && confirm(`Book ${u.label} from ${nice(d)}? (Cancel to block the dates instead)`)) onNew(u.unitId, d);
                            else if (canBlock) void block(u.unitId, d);
                            else onNew(u.unitId, d);
                          }}
                        >
                          {clean ? "🧹" : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── New booking ───────────────────────────────────────────────────────────

function NewBooking({ units, initial, onDone }: { units: StayUnitRow[]; initial: { unitId: string; checkIn: string }; onDone: (id: string) => void }) {
  const [f, setF] = useState({ unitId: initial.unitId || units[0].unitId, source: "DIRECT" as Source, externalRef: "", guestName: "", guestPhone: "", guestEmail: "", guests: "1", checkIn: initial.checkIn, checkOut: addDays(initial.checkIn, 2), accommodation: "", cleaningFee: "", channelFee: "", notes: "" });
  const [quote, setQuote] = useState<{ nights: number; accommodation: number; cleaningFee: number; total: number; clash: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const direct = f.source === "DIRECT";

  useEffect(() => {
    if (!f.unitId || !(f.checkIn < f.checkOut)) return setQuote(null);
    apiGet<typeof quote>(`/rental/stays/quote?unitId=${f.unitId}&checkIn=${f.checkIn}&checkOut=${f.checkOut}`).then(setQuote).catch(() => setQuote(null));
  }, [f.unitId, f.checkIn, f.checkOut]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
      const s = await apiPost<Stay>("/rental/stays", {
        unitId: f.unitId, source: f.source, externalRef: f.externalRef || undefined, guestName: f.guestName, guestPhone: f.guestPhone || undefined, guestEmail: f.guestEmail || undefined,
        guests: Number(f.guests) || 1, checkIn: f.checkIn, checkOut: f.checkOut, notes: f.notes || undefined,
        accommodation: direct ? undefined : n(f.accommodation), cleaningFee: n(f.cleaningFee), channelFee: direct ? undefined : n(f.channelFee),
      });
      onDone(s.id);
    } catch (err) {
      setError(errText(err, "Could not save the booking."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Unit">
          <select className={input} value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
            {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.property} - {u.label}</option>)}
          </select>
        </Field>
        <Field label="Booked through">
          <select className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as Source })}>
            {Object.entries(SOURCE_LABEL).filter(([k]) => k !== "MANUAL").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Check-in"><input type="date" className={input} value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} required /></Field>
        <Field label="Check-out (the day they leave)"><input type="date" className={input} value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} required /></Field>
        <Field label="Guest name"><input className={input} value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} required minLength={2} /></Field>
        <Field label="Guests"><input className={input} inputMode="numeric" value={f.guests} onChange={(e) => setF({ ...f, guests: e.target.value })} /></Field>
        <Field label="Phone (for texts)"><input className={input} inputMode="tel" value={f.guestPhone} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} /></Field>
        <Field label="Email"><input type="email" className={input} value={f.guestEmail} onChange={(e) => setF({ ...f, guestEmail: e.target.value })} /></Field>
        {!direct && (
          <>
            <Field label={`${SOURCE_LABEL[f.source]} confirmation code`}><input className={input} value={f.externalRef} onChange={(e) => setF({ ...f, externalRef: e.target.value })} /></Field>
            <Field label="Price of the nights (as on the booking site)"><input className={input} inputMode="decimal" placeholder={quote ? String(quote.accommodation) : ""} value={f.accommodation} onChange={(e) => setF({ ...f, accommodation: e.target.value })} /></Field>
            <Field label="Site's fee (what they keep from you)"><input className={input} inputMode="decimal" value={f.channelFee} onChange={(e) => setF({ ...f, channelFee: e.target.value })} /></Field>
          </>
        )}
        <Field label="Cleaning fee"><input className={input} inputMode="decimal" placeholder={quote ? String(quote.cleaningFee) : ""} value={f.cleaningFee} onChange={(e) => setF({ ...f, cleaningFee: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><input className={input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {quote && (
        <p className="rounded-md border border-border p-2 text-sm">
          {quote.nights} {quote.nights === 1 ? "night" : "nights"}: KES {money(direct || !f.accommodation ? quote.accommodation : Number(f.accommodation))} + cleaning {money(f.cleaningFee ? Number(f.cleaningFee) : quote.cleaningFee)}
          {quote.clash && <span className="block text-red-500">{quote.clash}</span>}
        </p>
      )}
      <Messages error={error} notice={null} />
      <button className={button} disabled={busy}>{busy ? "Saving..." : "Save booking"}</button>
    </form>
  );
}

// ── One booking ───────────────────────────────────────────────────────────

function StayDetail({ id, caretaker }: { id: string; caretaker: boolean }) {
  const [s, setS] = useState<Stay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pay, setPay] = useState({ kind: "PAYMENT", amount: "", method: "MPESA", reference: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<Stay>(`/rental/stays/${id}`).then(setS).catch((e) => setError(errText(e, "Could not open the booking.")));
  }, [id]);

  async function act(fn: () => Promise<Stay>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setS(await fn());
      if (done) setNotice(done);
    } catch (e) {
      setError(errText(e, "That did not save."));
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <Messages error={error} notice={null} />;
  const on = s.status === "CONFIRMED" || s.status === "CHECKED_IN";
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded px-2 py-0.5 text-xs text-white" style={{ background: SOURCE_COLOUR[s.source] }}>{s.sourceLabel}</span>
        <span className="font-mono">{s.code}</span>
        {s.externalRef && <span className="text-secondary-500">({s.externalRef})</span>}
        <span className="rounded border border-border px-2 py-0.5 text-xs">{STATUS_LABEL[s.status]}</span>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        <p><b>{s.guestName}</b> · {s.guests} {s.guests === 1 ? "guest" : "guests"}</p>
        <p>{s.guestPhone ? <a className="underline" href={`tel:${s.guestPhone}`}>{s.guestPhone}</a> : null} {s.guestEmail ?? ""}</p>
        <p>{s.property} - <b>{s.unit}</b></p>
        <p>{nice(s.checkIn)} to {nice(s.checkOut)} ({s.nights} {s.nights === 1 ? "night" : "nights"})</p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          <tr><td>Nights</td><td className="text-right">{money(s.accommodation)}</td></tr>
          <tr><td>Cleaning</td><td className="text-right">{money(s.cleaningFee)}</td></tr>
          {s.channelFee > 0 && <tr><td>Kept by {s.sourceLabel}</td><td className="text-right">-{money(s.channelFee)}</td></tr>}
          <tr><td>Paid</td><td className="text-right">{money(s.paid)}</td></tr>
          <tr className="font-bold"><td>{s.balance < 0 ? "To refund" : "Balance"}</td><td className="text-right" style={{ color: s.balance > 0 ? ORANGE : undefined }}>KES {money(Math.abs(s.balance))}</td></tr>
        </tbody>
      </table>
      {s.cancelReason && <p className="text-secondary-500">Reason: {s.cancelReason}</p>}
      {s.notes && <p className="text-secondary-500">{s.notes}</p>}
      <Messages error={error} notice={notice} />
      <div className="flex flex-wrap gap-2">
        {s.status === "CONFIRMED" && <button className={button} disabled={busy} onClick={() => act(() => apiPost<Stay>(`/rental/stays/${id}/check-in`, {}), "Checked in.")}>Check in</button>}
        {s.status === "CHECKED_IN" && <button className={button} disabled={busy} onClick={() => act(() => apiPost<Stay>(`/rental/stays/${id}/check-out`, {}), "Checked out. The cleaning is on the list.")}>Check out</button>}
        {on && (
          <button className={small} disabled={busy} onClick={() => {
            const checkOut = window.prompt("New check-out date (YYYY-MM-DD)", s.checkOut);
            if (!checkOut) return;
            const checkIn = s.status === "CONFIRMED" ? window.prompt("Check-in date (YYYY-MM-DD)", s.checkIn) ?? s.checkIn : s.checkIn;
            void act(() => apiPatch<Stay>(`/rental/stays/${id}`, { checkIn, checkOut }), "Dates changed.");
          }}>Change dates</button>
        )}
        {s.status === "CONFIRMED" && (
          <button className={small} disabled={busy} onClick={() => {
            const reason = window.prompt("The guest did not come. Note anything to remember:", "Did not arrive");
            if (reason) void act(() => apiPost<Stay>(`/rental/stays/${id}/no-show`, { reason }));
          }}>No-show</button>
        )}
        {s.status === "CONFIRMED" && !caretaker && (
          <button className={small} disabled={busy} onClick={() => {
            const reason = window.prompt("Why is this booking cancelled?", "");
            if (reason && reason.length >= 3) void act(() => apiPost<Stay>(`/rental/stays/${id}/cancel`, { reason }));
          }}>Cancel booking</button>
        )}
      </div>

      <h4 className="pt-2 font-semibold">Payments</h4>
      {s.payments.length === 0 && <p className="text-secondary-500">Nothing paid yet.</p>}
      <ul className="divide-y divide-border">
        {s.payments.map((p) => (
          <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 py-1 ${p.voided ? "line-through opacity-60" : ""}`}>
            <span>{p.paidAt} · {p.kind === "REFUND" ? "Refund" : METHODS.find((m) => m[0] === p.method)?.[1] ?? p.method}{p.reference ? ` ${p.reference}` : ""} · <span className="font-mono text-xs">{p.receiptNumber}</span></span>
            <span className="flex items-center gap-2">
              <b>{p.kind === "REFUND" ? "-" : ""}{money(p.amount)}</b>
              {!p.voided && !caretaker && (
                <button className={small} onClick={() => {
                  const reason = window.prompt("Why void this payment?", "");
                  if (reason && reason.length >= 3) void act(() => apiPost<Stay>(`/rental/stays/${id}/payments/${p.id}/void`, { reason }));
                }}>Void</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {(s.balance > 0 || s.paid > 0) && (
        <form className="grid gap-2 sm:grid-cols-5" onSubmit={(e) => {
          e.preventDefault();
          void act(() => apiPost<Stay>(`/rental/stays/${id}/payments`, { kind: pay.kind, amount: Number(pay.amount), method: pay.method, reference: pay.reference || undefined }), "Recorded.").then(() => setPay({ ...pay, amount: "", reference: "" }));
        }}>
          <select className={input} value={pay.kind} onChange={(e) => setPay({ ...pay, kind: e.target.value })}>
            <option value="PAYMENT">Payment</option>
            {s.paid > 0 && <option value="REFUND">Refund</option>}
          </select>
          <input className={input} inputMode="decimal" placeholder={s.balance > 0 ? String(s.balance) : "Amount"} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required />
          <select className={input} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className={input} placeholder="M-Pesa code / ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
          <button className={button} disabled={busy}>Record</button>
        </form>
      )}
    </div>
  );
}

// ── Bookings list ─────────────────────────────────────────────────────────

function BookingsView({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [view, setView] = useState("upcoming");
  const [rows, setRows] = useState<Stay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<Stay[]>(`/rental/stays?view=${view}`).then(setRows).catch((e) => setError(errText(e, "Could not load bookings.")));
  }, [view]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-md border border-border bg-surface p-2 text-sm" value={view} onChange={(e) => setView(e.target.value)}>
          <option value="upcoming">Coming and staying</option>
          <option value="current">In now</option>
          <option value="past">Past</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </select>
        <button className={button} onClick={onNew}>New booking</button>
      </div>
      <Messages error={error} notice={null} />
      {rows && rows.length === 0 && <p className="text-sm text-secondary-500">No bookings here.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows?.map((s) => (
          <li key={s.id}>
            <button className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-background" onClick={() => onOpen(s.id)}>
              <span>
                <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: SOURCE_COLOUR[s.source] }} />
                <b>{s.guestName}</b> · {s.unit} · {nice(s.checkIn)} to {nice(s.checkOut)}
                <span className="block text-xs text-secondary-500">{s.code} · {s.sourceLabel} · {STATUS_LABEL[s.status]}</span>
              </span>
              <span className="text-right">
                KES {money(s.total)}
                {s.balance > 0 && <span className="block text-xs" style={{ color: ORANGE }}>owes {money(s.balance)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Cleaning ──────────────────────────────────────────────────────────────

function CleaningView({ units }: { units: StayUnitRow[] }) {
  const [done, setDone] = useState(false);
  const [rows, setRows] = useState<Cleaning[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ unitId: "", dueDate: todayIso(), notes: "" });
  const load = useCallback(async () => {
    try {
      setRows(await apiGet<Cleaning[]>(`/rental/stays/cleanings${done ? "?view=done" : ""}`));
    } catch (e) {
      setError(errText(e, "Could not load the cleaning list."));
    }
  }, [done]);
  useEffect(() => {
    void load();
  }, [load]);

  async function markDone(c: Cleaning) {
    const notes = window.prompt(`${c.unit} cleaned. Any note? (linen changed, something broken...)`, "");
    if (notes === null) return;
    try {
      await apiPost(`/rental/stays/cleanings/${c.id}/done`, { notes: notes || undefined });
      await load();
    } catch (e) {
      setError(errText(e, "Could not save."));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button className={small} style={!done ? { background: NAVY, color: "white" } : undefined} onClick={() => setDone(false)}>To clean (next 7 days)</button>
        <button className={small} style={done ? { background: NAVY, color: "white" } : undefined} onClick={() => setDone(true)}>Done</button>
      </div>
      <Messages error={error} notice={null} />
      {rows && rows.length === 0 && <p className="text-sm text-secondary-500">{done ? "Nothing cleaned yet." : "Nothing to clean in the next 7 days."}</p>}
      <ul className="space-y-2">
        {rows?.map((c) => (
          <li key={c.id} className="rounded-lg border border-border bg-surface p-3 text-sm" style={c.overdue ? { borderColor: ORANGE } : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{c.unit}</b> <span className="text-secondary-500">{c.property}</span>
                <span className="block text-xs">
                  {c.status === "DONE" ? "Cleaned" : c.overdue ? "Overdue since" : "Due"} {nice(c.dueDate)}
                  {c.stay ? ` · after ${c.stay.guestName} (${c.stay.code})${c.stay.guestLeft ? ", guest has left" : ""}` : ""}
                  {c.nextArrival ? ` · next guest ${nice(c.nextArrival)}` : ""}
                </span>
                {(c.cleanerName || c.cleanerPhone) && <span className="block text-xs text-secondary-500">{c.cleanerName} {c.cleanerPhone && <a className="underline" href={`tel:${c.cleanerPhone}`}>{c.cleanerPhone}</a>}</span>}
                {c.notes && <span className="block text-xs text-secondary-500">{c.notes}</span>}
              </span>
              {c.status === "PENDING" && <button className={button} onClick={() => markDone(c)}>Cleaned</button>}
            </div>
          </li>
        ))}
      </ul>
      {!done && units.length > 0 && (
        <form className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-4" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await apiPost("/rental/stays/cleanings", { unitId: form.unitId || units[0].unitId, dueDate: form.dueDate, notes: form.notes || undefined });
            setForm({ ...form, notes: "" });
            await load();
          } catch (err) {
            setError(errText(err, "Could not add the cleaning."));
          }
        }}>
          <select className={input} value={form.unitId || units[0].unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
            {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.label}</option>)}
          </select>
          <input type="date" className={input} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          <input className={input} placeholder="e.g. Deep clean" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button className={small}>Add a cleaning</button>
        </form>
      )}
    </div>
  );
}

// ── Units, calendars and settings ─────────────────────────────────────────

function UnitsView({ units, reload, onUpgrade }: { units: StayUnitRow[]; reload: () => Promise<void>; onUpgrade: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [settings, setSettings] = useState<{ stayTexts: boolean; smsAvailable: boolean; calendarLinksAvailable: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    apiGet<Owner[]>("/rental/stays/owners").then(setOwners).catch(() => setOwners([]));
    apiGet<typeof settings>("/rental/stays/settings").then(setSettings).catch(() => null);
  }, []);

  async function run(fn: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) onUpgrade();
      setError(errText(e, "That did not save."));
    }
  }

  function copy(text: string | null) {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => setNotice("Link copied. Paste it into the booking site's calendar import."));
  }

  return (
    <div className="space-y-4">
      {settings && (
        <label className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={settings.stayTexts} onChange={(e) => void apiPut<typeof settings>("/rental/stays/settings", { stayTexts: e.target.checked }).then(setSettings)} />
          <span>
            Text guests and the cleaner (booking confirmation, directions and door code the day before, thank-you, cleaning after check-out). Email is always used when the guest gave one. Airbnb and Booking.com guests are messaged by those sites, not by us.
            {!settings.smsAvailable && <span className="block text-xs text-amber-500">Texts are not set up on this server yet, so email is used.</span>}
          </span>
        </label>
      )}
      <Messages error={error} notice={notice} />
      <ul className="space-y-2">
        {units.map((u) => (
          <li key={u.unitId} className="rounded-lg border border-border bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{u.label}</b> <span className="text-secondary-500">{u.property}</span>
                <span className="block text-xs">
                  {u.shortStay?.active ? `Let by the night · KES ${money(u.shortStay.nightlyRate)}${u.shortStay.weekendRate ? ` (weekend ${money(u.shortStay.weekendRate)})` : ""}${u.shortStay.owner ? ` · owner ${u.shortStay.owner}` : ""}` : u.unitStatus === "OCCUPIED" ? "On a lease" : u.shortStay ? "Short stays off" : "Not let by the night"}
                </span>
              </span>
              {u.unitStatus !== "OCCUPIED" && <button className={small} onClick={() => setEditing(editing === u.unitId ? null : u.unitId)}>{u.shortStay ? "Edit" : "Let by the night"}</button>}
            </div>
            {editing === u.unitId && <UnitForm u={u} owners={owners} onSave={(body) => run(() => apiPut(`/rental/stays/units/${u.unitId}`, body), "Saved.").then(() => setEditing(null))} />}
            {u.shortStay?.active && (
              <div className="mt-3 space-y-2 border-t border-border pt-2 text-xs">
                <p className="font-semibold">Calendar sync</p>
                {settings && !settings.calendarLinksAvailable && <p className="text-amber-500">Calendar links need the server's public address set (PUBLIC_API_BASE_URL).</p>}
                {u.shortStay.calendarUrls.AIRBNB && (
                  <p>
                    Give these to the booking sites so our bookings block your dates there:{" "}
                    <button className={small} onClick={() => copy(u.shortStay!.calendarUrls.AIRBNB)}>Copy link for Airbnb</button>{" "}
                    <button className={small} onClick={() => copy(u.shortStay!.calendarUrls.BOOKING_COM)}>Copy link for Booking.com</button>{" "}
                    <button className={small} onClick={() => confirm("Make new links? The old links stop working; paste the new ones into Airbnb and Booking.com.") && void run(() => apiPost(`/rental/stays/units/${u.unitId}/new-calendar-link`, {}), "New links made. Paste them into the booking sites.")}>New links</button>
                  </p>
                )}
                {u.shortStay.feeds.map((f) => (
                  <p key={f.id} className="flex flex-wrap items-center gap-2">
                    <span className="rounded px-1.5 py-0.5 text-white" style={{ background: SOURCE_COLOUR[f.source] }}>{SOURCE_LABEL[f.source]}</span>
                    <span className="max-w-xs truncate">{f.url}</span>
                    <span className={f.lastError ? "text-red-500" : "text-secondary-500"}>{f.lastError ?? (f.lastSyncedAt ? `${f.eventCount} dates read ${new Date(f.lastSyncedAt).toLocaleString("en-KE")}` : "Not read yet")}</span>
                    <button className={small} onClick={() => void run(() => apiPost(`/rental/stays/feeds/${f.id}/sync`, {}), "Calendar read.")}>Read now</button>
                    <button className={small} onClick={() => confirm("Unlink this calendar? Its dates are freed here.") && void run(() => apiDelete(`/rental/stays/feeds/${f.id}`), "Unlinked.")}>Unlink</button>
                  </p>
                ))}
                <FeedForm onAdd={(source, url) => run(() => apiPost(`/rental/stays/units/${u.unitId}/feeds`, { source, url }), "Calendar linked and read. It is read again every hour.")} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnitForm({ u, owners, onSave }: { u: StayUnitRow; owners: Owner[]; onSave: (body: Record<string, unknown>) => void }) {
  const s = u.shortStay;
  const [f, setF] = useState({
    nightlyRate: s ? String(s.nightlyRate) : "", weekendRate: s?.weekendRate ? String(s.weekendRate) : "", minNights: String(s?.minNights ?? 1), maxGuests: String(s?.maxGuests ?? 2),
    cleaningFee: String(s?.cleaningFee ?? 0), checkInTime: s?.checkInTime ?? "14:00", checkOutTime: s?.checkOutTime ?? "10:00", directions: s?.directions ?? "", doorCode: s?.doorCode ?? "",
    cleanerName: s?.cleanerName ?? "", cleanerPhone: s?.cleanerPhone ?? "", ownerId: s?.ownerId ?? "", active: s?.active ?? true,
  });
  return (
    <form className="mt-3 grid gap-2 sm:grid-cols-3" onSubmit={(e) => {
      e.preventDefault();
      onSave({
        nightlyRate: Number(f.nightlyRate), weekendRate: f.weekendRate ? Number(f.weekendRate) : null, minNights: Number(f.minNights) || 1, maxGuests: Number(f.maxGuests) || 2,
        cleaningFee: Number(f.cleaningFee) || 0, checkInTime: f.checkInTime, checkOutTime: f.checkOutTime, directions: f.directions || null, doorCode: f.doorCode || null,
        cleanerName: f.cleanerName || null, cleanerPhone: f.cleanerPhone || null, ownerId: f.ownerId || null, active: f.active,
      });
    }}>
      <Field label="Price per night (KES)"><input className={input} inputMode="decimal" value={f.nightlyRate} onChange={(e) => setF({ ...f, nightlyRate: e.target.value })} required /></Field>
      <Field label="Friday & Saturday nights (optional)"><input className={input} inputMode="decimal" value={f.weekendRate} onChange={(e) => setF({ ...f, weekendRate: e.target.value })} /></Field>
      <Field label="Cleaning fee per stay"><input className={input} inputMode="decimal" value={f.cleaningFee} onChange={(e) => setF({ ...f, cleaningFee: e.target.value })} /></Field>
      <Field label="Fewest nights"><input className={input} inputMode="numeric" value={f.minNights} onChange={(e) => setF({ ...f, minNights: e.target.value })} /></Field>
      <Field label="Most guests"><input className={input} inputMode="numeric" value={f.maxGuests} onChange={(e) => setF({ ...f, maxGuests: e.target.value })} /></Field>
      <Field label="Owner (if you manage it for someone)">
        <select className={input} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>
          <option value="">My own unit</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </Field>
      <Field label="Check-in from"><input type="time" className={input} value={f.checkInTime} onChange={(e) => setF({ ...f, checkInTime: e.target.value })} /></Field>
      <Field label="Check-out by"><input type="time" className={input} value={f.checkOutTime} onChange={(e) => setF({ ...f, checkOutTime: e.target.value })} /></Field>
      <Field label="Door / lockbox code (sent the day before)"><input className={input} value={f.doorCode} onChange={(e) => setF({ ...f, doorCode: e.target.value })} /></Field>
      <div className="sm:col-span-3"><Field label="Directions for guests"><input className={input} placeholder="e.g. Gate 2 off Argwings Kodhek Rd, block A, 4th floor" value={f.directions} onChange={(e) => setF({ ...f, directions: e.target.value })} /></Field></div>
      <Field label="Cleaner's name"><input className={input} value={f.cleanerName} onChange={(e) => setF({ ...f, cleanerName: e.target.value })} /></Field>
      <Field label="Cleaner's phone"><input className={input} inputMode="tel" value={f.cleanerPhone} onChange={(e) => setF({ ...f, cleanerPhone: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Taking short-stay bookings</label>
      <button className={button}>Save</button>
    </form>
  );
}

function FeedForm({ onAdd }: { onAdd: (source: string, url: string) => Promise<void> }) {
  const [source, setSource] = useState("AIRBNB");
  const [url, setUrl] = useState("");
  return (
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void onAdd(source, url).then(() => setUrl("")); }}>
      <select className="rounded-md border border-border bg-surface p-1 text-xs" value={source} onChange={(e) => setSource(e.target.value)}>
        <option value="AIRBNB">Airbnb</option>
        <option value="BOOKING_COM">Booking.com</option>
        <option value="OTHER">Other site</option>
      </select>
      <input className="min-w-0 flex-1 rounded-md border border-border bg-surface p-1 text-xs" placeholder="Paste the site's calendar export link (.ics)" value={url} onChange={(e) => setUrl(e.target.value)} required />
      <button className={small}>Link calendar</button>
    </form>
  );
}

// ── Owners and statements ─────────────────────────────────────────────────

function OwnersView() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [form, setForm] = useState({ name: "", phone: "", email: "", commissionPercent: "" });
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [ownerId, setOwnerId] = useState("");
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadOwners = useCallback(() => apiGet<Owner[]>("/rental/stays/owners").then(setOwners).catch((e) => setError(errText(e, "Could not load owners."))), []);
  useEffect(() => {
    void loadOwners();
  }, [loadOwners]);
  const q = `month=${month}${ownerId ? `&ownerId=${ownerId}` : ""}`;
  useEffect(() => {
    apiGet<Statement>(`/rental/stays/statements?${q}`).then(setStmt).catch((e) => setError(errText(e, "Could not load the statement.")));
  }, [q]);

  return (
    <div className="space-y-4">
      <Messages error={error} notice={null} />
      <div className="rounded-lg border border-border bg-surface p-3">
        <h4 className="mb-2 font-semibold">Owners you let units for</h4>
        <ul className="mb-3 divide-y divide-border text-sm">
          {owners.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><b>{o.name}</b> · {o.commissionPercent}% commission · {o.units} {o.units === 1 ? "unit" : "units"}<span className="block text-xs text-secondary-500">{[o.phone, o.email].filter(Boolean).join(" · ")}</span></span>
              <span className="flex gap-2">
                <button className={small} onClick={() => {
                  const c = window.prompt(`${o.name}'s commission (% of income after the booking sites' fees)`, String(o.commissionPercent));
                  if (c !== null) void apiPut(`/rental/stays/owners/${o.id}`, { name: o.name, phone: o.phone, email: o.email, notes: o.notes, commissionPercent: Number(c) }).then(loadOwners).catch((e) => setError(errText(e, "Could not save.")));
                }}>Commission</button>
                <button className={small} onClick={() => confirm(`Remove ${o.name}? Their units become your own units.`) && void apiDelete(`/rental/stays/owners/${o.id}`).then(loadOwners).catch((e) => setError(errText(e, "Could not remove.")))}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
        <form className="grid gap-2 sm:grid-cols-5" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await apiPost("/rental/stays/owners", { name: form.name, phone: form.phone || undefined, email: form.email || undefined, commissionPercent: form.commissionPercent ? Number(form.commissionPercent) : 0 });
            setForm({ name: "", phone: "", email: "", commissionPercent: "" });
            await loadOwners();
          } catch (err) {
            setError(errText(err, "Could not add the owner."));
          }
        }}>
          <input className={input} placeholder="Owner's name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
          <input className={input} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className={input} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={input} inputMode="decimal" placeholder="Commission %" value={form.commissionPercent} onChange={(e) => setForm({ ...form, commissionPercent: e.target.value })} />
          <button className={button}>Add owner</button>
        </form>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="font-semibold">Monthly statement</h4>
          <input type="month" className="rounded-md border border-border bg-surface p-1 text-sm" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <select className="rounded-md border border-border bg-surface p-1 text-sm" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Everyone</option>
            <option value="own">My own units</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className={small} onClick={() => void apiGet<{ filename: string; csv: string }>(`/rental/stays/statements?${q}&format=csv`).then((r) => downloadCsv(r.filename, r.csv))}>Download CSV</button>
          <button className={small} onClick={() => window.print()}>Print</button>
        </div>
        <p className="mb-2 text-xs text-secondary-500">Nights are counted in the month they fall in (a stay across two months is shared). Commission is on income after the booking sites' fees; expenses are those recorded against the unit that month.</p>
        {stmt?.owners.length === 0 && <p className="text-sm text-secondary-500">No units let by the night for this choice.</p>}
        {stmt?.owners.map((o) => (
          <div key={o.ownerId ?? "own"} className="mb-4 overflow-x-auto">
            <p className="font-semibold">{o.owner}{o.ownerId ? ` · ${o.commissionPercent}%` : ""}</p>
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-secondary-500">
                  <th className="p-1">Unit</th><th className="p-1 text-right">Nights</th><th className="p-1 text-right">Occupied</th><th className="p-1 text-right">Nights KES</th><th className="p-1 text-right">Cleaning</th><th className="p-1 text-right">Site fees</th><th className="p-1 text-right">Commission</th><th className="p-1 text-right">Expenses</th><th className="p-1 text-right">Payable</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.property + l.unit} className="border-t border-border">
                    <td className="p-1">{l.unit} <span className="text-secondary-500">{l.property}</span></td>
                    <td className="p-1 text-right">{l.nights}</td><td className="p-1 text-right">{l.occupancyPercent}%</td><td className="p-1 text-right">{money(l.accommodation)}</td><td className="p-1 text-right">{money(l.cleaning)}</td>
                    <td className="p-1 text-right">{money(l.channelFees)}</td><td className="p-1 text-right">{money(l.commission)}</td><td className="p-1 text-right">{money(l.expenses)}</td><td className="p-1 text-right font-semibold">{money(l.payable)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-bold" style={{ borderColor: GOLD }}>
                  <td className="p-1">Total</td><td className="p-1 text-right">{o.totals.nights}</td><td /><td className="p-1 text-right">{money(o.totals.accommodation)}</td><td className="p-1 text-right">{money(o.totals.cleaning)}</td>
                  <td className="p-1 text-right">{money(o.totals.channelFees)}</td><td className="p-1 text-right">{money(o.totals.commission)}</td><td className="p-1 text-right">{money(o.totals.expenses)}</td><td className="p-1 text-right">{money(o.totals.payable)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
