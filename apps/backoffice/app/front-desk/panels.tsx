"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { addDays, field, ghostBtn, kes, MEAL_LABEL, METHOD_LABEL, primaryBtn, today, type Board, type DeskBooking, type Folio, type GuestSummary, type MealPlan, type Room, type RoomType, type StayQuote } from "./types";

export const explain = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** A centred box over the page. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-6 w-full max-w-xl space-y-3 rounded-xl border border-border bg-background p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-sm text-secondary-500 hover:text-foreground">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Msg = ({ error }: { error: string | null }) => (error ? <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{error}</p> : null);

export type Method = "CASH" | "MPESA_RECEIPT" | "CARD";
export const METHODS: [Method, string][] = [
  ["CASH", "Cash"],
  ["MPESA_RECEIPT", "M-Pesa (receipt code)"],
  ["CARD", "Card"],
];

// ── A new booking ───────────────────────────────────────────────────────

export function NewBookingPanel({ types, rooms, isManager, onClose, onDone }: { types: RoomType[]; rooms: Room[]; isManager: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [f, setF] = useState({ guestName: "", phone: "", idNumber: "", nationality: "", email: "", address: "", vehicleReg: "", guests: "1", children: "0", mealPlan: "ROOM_ONLY" as MealPlan, checkIn: today(), checkOut: addDays(today(), 1), roomTypeId: types[0]?.id ?? "", roomId: "", rate: "", source: "FRONT_DESK", notes: "" });
  const [dep, setDep] = useState({ amount: "", method: "CASH" as Method, reference: "" });
  const [guestId, setGuestId] = useState<string | null>(null);
  const [found, setFound] = useState<GuestSummary[] | null>(null);
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = types.find((t) => t.id === f.roomTypeId);
  const roomsOfType = rooms.filter((r) => r.roomTypeId === f.roomTypeId && r.status !== "OUT_OF_ORDER");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const guestCount = Number(f.guests) || 1;
  const childCount = Math.min(Number(f.children) || 0, Math.max(guestCount - 1, 0));

  // The price comes from the hotel's own price list (seasons, weekends, extra guests, meals), the same one the marketplace uses.
  useEffect(() => {
    if (!f.roomTypeId || f.checkOut <= f.checkIn) {
      setQuote(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      apiPost<StayQuote>("/hotel/bookings/quote", { roomTypeId: f.roomTypeId, checkIn: f.checkIn, checkOut: f.checkOut, rooms: 1, guests: guestCount, children: childCount, mealPlan: f.mealPlan, rate: isManager && f.rate ? Number(f.rate) : undefined })
        .then((q) => live && (setQuote(q), setQuoteError(null)))
        .catch((e) => live && (setQuote(null), setQuoteError(explain(e, "Could not work out the price."))));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [f.roomTypeId, f.checkIn, f.checkOut, guestCount, childCount, f.mealPlan, f.rate, isManager]);

  async function lookup() {
    setError(null);
    try {
      const q = new URLSearchParams();
      if (f.phone.trim()) q.set("phone", f.phone.trim());
      if (f.idNumber.trim()) q.set("idNumber", f.idNumber.trim());
      if (!q.toString()) return setError("Type the phone number or ID number first.");
      setFound(await apiGet<GuestSummary[]>(`/hotel/guests/lookup?${q.toString()}`));
    } catch (err) {
      setError(explain(err, "Could not look the guest up."));
    }
  }

  function pick(g: GuestSummary) {
    setGuestId(g.id);
    setFound(null);
    setF((x) => ({ ...x, guestName: g.fullName, phone: g.phone, email: g.email ?? x.email, nationality: g.nationality ?? x.nationality, vehicleReg: g.vehicleReg ?? x.vehicleReg }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await apiPost<{ bookingNumber: string; guestName: string }>("/hotel/bookings", {
        guestName: f.guestName,
        phone: f.phone,
        idNumber: f.idNumber || undefined,
        nationality: f.nationality || undefined,
        email: f.email || undefined,
        address: f.address || undefined,
        vehicleReg: f.vehicleReg || undefined,
        guestId: guestId ?? undefined,
        guests: guestCount,
        children: childCount || undefined,
        mealPlan: f.mealPlan,
        checkIn: f.checkIn,
        checkOut: f.checkOut,
        roomTypeId: f.roomTypeId,
        roomId: f.roomId || undefined,
        rate: isManager && f.rate ? Number(f.rate) : undefined,
        source: f.source,
        notes: f.notes || undefined,
        deposit: dep.amount ? { method: dep.method, amount: Number(dep.amount), reference: dep.reference || undefined } : undefined,
      });
      onDone(`Booked ${made.guestName} (${made.bookingNumber}).`);
    } catch (err) {
      setError(explain(err, "Could not make the booking."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New booking" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Msg error={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Phone<input required className={field} inputMode="tel" value={f.phone} onChange={(e) => { set("phone", e.target.value); setGuestId(null); }} placeholder="0712 345 678" /></label>
          <label className="text-sm">ID / passport number<input className={field} value={f.idNumber} onChange={(e) => { set("idNumber", e.target.value); setGuestId(null); }} /></label>
          <div className="sm:col-span-2">
            <button type="button" className={ghostBtn} onClick={() => void lookup()}>Find a returning guest</button>
            {guestId && <span className="ml-2 text-sm text-green-500">Returning guest chosen - their details are filled in.</span>}
            {found && found.length === 0 && <span className="ml-2 text-sm text-secondary-500">Nobody with that phone or ID yet - a new guest will be added.</span>}
            {found && found.length > 0 && (
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {found.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                    <span>
                      <strong>{g.fullName}</strong> · {g.phone}
                      {g.idNumber ? ` · ID ${g.idNumber}` : ""} · {g.stays ?? 0} stay{g.stays === 1 ? "" : "s"}
                      {g.smsOptOut && <span className="ml-2 text-xs text-amber-500">no texts</span>}
                    </span>
                    <button type="button" className={ghostBtn} onClick={() => pick(g)}>Use</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="text-sm">Guest name<input required className={field} value={f.guestName} onChange={(e) => set("guestName", e.target.value)} /></label>
          <label className="text-sm">Nationality<input className={field} value={f.nationality} onChange={(e) => set("nationality", e.target.value)} /></label>
          <label className="text-sm">Address <span className="text-secondary-500">(optional)</span><input className={field} maxLength={300} value={f.address} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="text-sm">Vehicle registration <span className="text-secondary-500">(optional)</span><input className={field} maxLength={20} value={f.vehicleReg} onChange={(e) => set("vehicleReg", e.target.value)} /></label>
          <label className="text-sm">Arrives<input required type="date" min={today()} className={field} value={f.checkIn} onChange={(e) => set("checkIn", e.target.value)} /></label>
          <label className="text-sm">Leaves<input required type="date" min={addDays(f.checkIn, 1)} className={field} value={f.checkOut} onChange={(e) => set("checkOut", e.target.value)} /></label>
          <label className="text-sm">Room type
            <select required className={field} value={f.roomTypeId} onChange={(e) => { set("roomTypeId", e.target.value); set("roomId", ""); }}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name} - from {kes(t.pricePerNight)} a night</option>)}
            </select>
          </label>
          <label className="text-sm">A particular room <span className="text-secondary-500">(optional)</span>
            <select className={field} value={f.roomId} onChange={(e) => set("roomId", e.target.value)}>
              <option value="">Any</option>
              {roomsOfType.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
            </select>
          </label>
          <label className="text-sm">Guests (all)<input required type="number" min={1} max={type?.maxGuests ?? 10} className={field} value={f.guests} onChange={(e) => set("guests", e.target.value)} /></label>
          <label className="text-sm">…of whom children<input type="number" min={0} max={Math.max(guestCount - 1, 0)} className={field} value={f.children} onChange={(e) => set("children", e.target.value)} /></label>
          <label className="text-sm">Meals
            <select className={field} value={f.mealPlan} onChange={(e) => set("mealPlan", e.target.value)}>
              {(Object.keys(MEAL_LABEL) as MealPlan[]).map((k) => <option key={k} value={k}>{MEAL_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="text-sm">Booked by<select className={field} value={f.source} onChange={(e) => set("source", e.target.value)}><option value="FRONT_DESK">Walk-in</option><option value="PHONE">Phone</option></select></label>
          {isManager && (
            <label className="text-sm sm:col-span-2">Rate per night <span className="text-secondary-500">(leave empty to use the hotel&apos;s price list; a change is logged)</span>
              <input type="number" min={1} step="0.01" className={field} value={f.rate} onChange={(e) => set("rate", e.target.value)} />
            </label>
          )}
          <label className="text-sm sm:col-span-2">Note <span className="text-secondary-500">(optional)</span><input maxLength={500} className={field} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">Deposit taken now <span className="font-normal text-secondary-500">(optional)</span></p>
          <div className="grid gap-3 sm:grid-cols-3">
            <input type="number" min={1} step="0.01" className={field} placeholder="Amount" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} />
            <select className={field} value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value as Method })}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className={field} placeholder={dep.method === "MPESA_RECEIPT" ? "M-Pesa code (needed)" : "Slip / reference"} value={dep.reference} onChange={(e) => setDep({ ...dep, reference: e.target.value })} />
          </div>
        </div>
        <QuoteBox quote={quote} error={quoteError} />
        <button disabled={busy || !f.roomTypeId} className={primaryBtn}>{busy ? "Booking..." : "Make the booking"}</button>
      </form>
    </Modal>
  );
}

/** The price of a stay as the price list works it out: each night that differs, extras, meals and the taxes by name. */
export function QuoteBox({ quote, error }: { quote: StayQuote | null; error: string | null }) {
  if (error) return <p className="text-sm text-amber-500">{error}</p>;
  if (!quote) return <p className="text-sm text-secondary-500">Choose the dates to see the price.</p>;
  const n = quote.nights.length;
  return (
    <div className="space-y-0.5 rounded-lg border border-border p-3 text-sm">
      <p className="flex justify-between"><span>{n} night{n === 1 ? "" : "s"} · room</span><span className="font-mono">{kes(quote.roomTotal)}</span></p>
      {quote.extraTotal > 0 && <p className="flex justify-between"><span>Extra guests</span><span className="font-mono">{kes(quote.extraTotal)}</span></p>}
      {quote.mealTotal > 0 && <p className="flex justify-between"><span>Meals</span><span className="font-mono">{kes(quote.mealTotal)}</span></p>}
      {quote.taxes.map((t) => <p key={t.name} className="flex justify-between text-secondary-500"><span>{t.name} {t.percent}%</span><span className="font-mono">{kes(t.amount)}</span></p>)}
      <p className="flex justify-between text-base font-bold"><span>Total</span><span className="font-mono">{kes(quote.total)}</span></p>
      {quote.nights.some((x) => x.source !== "BASE") && <p className="pt-1 text-xs text-secondary-500">Some nights use a weekend or season price: {quote.nights.map((x) => `${x.date.slice(5)} ${kes(x.rate)}`).join(" · ")}</p>}
    </div>
  );
}

// ── Check-in ────────────────────────────────────────────────────────────

export function CheckInPanel({ booking, board, isManager, onClose, onDone }: { booking: DeskBooking; board: Board; isManager: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const free = board.rooms.filter((r) => r.roomTypeId === booking.roomTypeId && r.status === "VACANT_CLEAN");
  const [chosen, setChosen] = useState<string[]>([]);
  const [early, setEarly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooEarly = booking.checkIn > board.date;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/hotel/bookings/${booking.id}/check-in`, { roomIds: chosen, overrideEarly: tooEarly && early ? true : undefined });
      onDone(`${booking.guestName} checked in.`);
    } catch (err) {
      setError(explain(err, "Could not check in."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Check in ${booking.guestName}`} onClose={onClose}>
      <Msg error={error} />
      <p className="text-sm text-secondary-500">{booking.roomTypeName}{booking.rooms > 1 ? ` x ${booking.rooms}` : ""} · {booking.checkIn} to {booking.checkOut}. Choose {booking.rooms} clean, vacant room{booking.rooms === 1 ? "" : "s"}.</p>
      {tooEarly && (
        <label className={`flex items-center gap-2 rounded-md p-2 text-sm ${isManager ? "bg-amber-950 text-amber-200" : "bg-secondary-500/10 text-secondary-500"}`}>
          <input type="checkbox" disabled={!isManager} checked={early} onChange={(e) => setEarly(e.target.checked)} />
          Arrives on {booking.checkIn}. {isManager ? "Allow an early check-in (this is logged)." : "Only a manager can allow an early check-in."}
        </label>
      )}
      {free.length === 0 && <p className="rounded-md bg-amber-950 p-2 text-sm text-amber-200">No clean, vacant {booking.roomTypeName} room right now. Check Housekeeping.</p>}
      <div className="flex flex-wrap gap-2">
        {free.map((r) => {
          const on = chosen.includes(r.id);
          return (
            <button key={r.id} type="button" onClick={() => setChosen((c) => (on ? c.filter((x) => x !== r.id) : c.length < booking.rooms ? [...c, r.id] : [...c.slice(1), r.id]))} className={`rounded-md border px-3 py-2 text-sm ${on ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
              Room {r.number}
            </button>
          );
        })}
      </div>
      <button onClick={() => void go()} disabled={busy || chosen.length !== booking.rooms || (tooEarly && !early)} className={primaryBtn}>{busy ? "Checking in..." : "Check in"}</button>
    </Modal>
  );
}

// ── The folio, payments, adjustments, refunds ───────────────────────────

/** The room taxes on a folio by name (VAT, tourism levy...), adding every night and every change to a night. */
export function taxByName(folio: Folio): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of folio.entries) if (e.type === "ROOM_NIGHT" && e.taxBreakdown) for (const [name, v] of Object.entries(e.taxBreakdown)) out[name] = Math.round(((out[name] ?? 0) + v) * 100) / 100;
  return out;
}

function FolioTable({ folio }: { folio: Folio }) {
  return (
    <>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {folio.entries.map((e) => (
              <tr key={e.id} className="border-t border-border first:border-t-0">
                <td className="p-2">
                  {e.description}
                  {e.method && <span className="block text-xs text-secondary-500">{METHOD_LABEL[e.method] ?? e.method}{e.reference ? ` ${e.reference}` : ""}</span>}
                </td>
                <td className={`p-2 text-right font-mono ${e.type === "PAYMENT" ? "text-green-500" : ""}`}>{e.type === "PAYMENT" ? "-" : ""}{kes(e.amount)}</td>
              </tr>
            ))}
            {folio.entries.length === 0 && <tr><td className="p-3 text-secondary-500">Nothing on the folio yet (the nights are added at check-in).</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="space-y-0.5 text-sm">
        <p className="flex justify-between"><span>Room nights (tax {kes(folio.totals.roomTax)} inside)</span><span className="font-mono">{kes(folio.totals.roomNights)}</span></p>
        {Object.entries(taxByName(folio)).map(([name, amount]) => <p key={name} className="flex justify-between pl-4 text-secondary-500"><span>{name}</span><span className="font-mono">{kes(amount)}</span></p>)}
        {folio.totals.charges > 0 && <p className="flex justify-between"><span>Charged to the room</span><span className="font-mono">{kes(folio.totals.charges)}</span></p>}
        {folio.totals.adjustments !== 0 && <p className="flex justify-between"><span>Adjustments</span><span className="font-mono">{kes(folio.totals.adjustments)}</span></p>}
        <p className="flex justify-between"><span>Paid</span><span className="font-mono">{kes(folio.totals.payments - folio.totals.refunds)}</span></p>
        <p className="flex justify-between text-base font-bold"><span>{folio.totals.balance >= 0 ? "Balance to pay" : "Owed back to the guest"}</span><span className="font-mono">{kes(Math.abs(folio.totals.balance))}</span></p>
      </div>
    </>
  );
}

function useFolio(bookingId: string) {
  const [folio, setFolio] = useState<Folio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => apiGet<Folio>(`/hotel/bookings/${bookingId}/folio`).then(setFolio).catch((e) => setError(explain(e, "Could not load the folio.")));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);
  return { folio, error, reload };
}

export function FolioPanel({ booking, isManager, onClose, onChanged }: { booking: DeskBooking; isManager: boolean; onClose: () => void; onChanged: () => void }) {
  const { folio, error: loadError, reload } = useFolio(booking.id);
  const [mode, setMode] = useState<"pay" | "adjust" | "refund" | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "pay") await apiPost(`/hotel/bookings/${booking.id}/payments`, { method, amount: Number(amount), reference: reference || undefined });
      if (mode === "adjust") await apiPost(`/hotel/bookings/${booking.id}/adjustments`, { amount: -Math.abs(Number(amount)), reason });
      if (mode === "refund") await apiPost(`/hotel/bookings/${booking.id}/refunds`, { method, amount: Number(amount), reference: reference || undefined, reason });
      setMode(null);
      setAmount("");
      setReference("");
      setReason("");
      await reload();
      onChanged();
    } catch (err) {
      setError(explain(err, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${booking.guestName} - folio`} onClose={onClose}>
      <Msg error={loadError ?? error} />
      {folio && <FolioTable folio={folio} />}
      <div className="flex flex-wrap gap-2">
        <button className={primaryBtn} onClick={() => setMode("pay")}>Take a payment</button>
        {isManager && <button className={ghostBtn} onClick={() => setMode("adjust")}>Take money off</button>}
        {isManager && <button className={ghostBtn} onClick={() => setMode("refund")}>Refund</button>}
        <Link href={`/hotel-print/folio/${booking.id}`} target="_blank" className={ghostBtn}>Print folio</Link>
        <Link href={`/hotel-print/card/${booking.id}`} target="_blank" className={ghostBtn}>Registration card</Link>
      </div>
      {mode && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">{mode === "pay" ? "Take a payment" : mode === "adjust" ? "Take money off the bill (a discount or correction)" : "Refund the guest"}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input type="number" min={1} step="0.01" className={field} placeholder="Amount (KES)" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {mode !== "adjust" && (
              <>
                <select className={field} value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input className={field} placeholder={method === "MPESA_RECEIPT" ? "M-Pesa code (needed)" : "Slip / reference"} value={reference} onChange={(e) => setReference(e.target.value)} />
              </>
            )}
          </div>
          {mode !== "pay" && <input className={field} placeholder="Why? (kept in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          <div className="flex gap-2">
            <button className={primaryBtn} disabled={busy || !amount || (mode !== "pay" && reason.trim().length < 3)} onClick={() => void submit()}>{busy ? "Saving..." : "Save"}</button>
            <button className={ghostBtn} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Check-out ───────────────────────────────────────────────────────────

interface PayRow {
  method: Method;
  amount: string;
  reference: string;
}

export function CheckOutPanel({ booking, isManager, onClose, onDone }: { booking: DeskBooking; isManager: boolean; onClose: () => void; onDone: (message: string, bookingId: string) => void }) {
  const { folio, error: loadError } = useFolio(booking.id);
  const [rows, setRows] = useState<PayRow[]>([]);
  const [leave, setLeave] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balance = folio?.totals.balance ?? 0;
  const taken = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const left = Math.round((balance - taken) * 100) / 100;
  useEffect(() => {
    if (folio && rows.length === 0 && folio.totals.balance > 0.01) setRows([{ method: "CASH", amount: folio.totals.balance.toFixed(2), reference: "" }]);
  }, [folio, rows.length]);
  const settled = Math.abs(left) < 0.01;
  const canLeave = isManager && leave.trim().length >= 3;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/hotel/bookings/${booking.id}/check-out`, {
        payments: rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount), reference: r.reference || undefined })),
        leaveBalanceReason: !settled && canLeave ? leave.trim() : undefined,
      });
      onDone(`${booking.guestName} checked out.`, booking.id);
    } catch (err) {
      setError(explain(err, "Could not check out."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Check out ${booking.guestName}`} onClose={onClose}>
      <Msg error={loadError ?? error} />
      {folio && <FolioTable folio={folio} />}
      {folio && balance > 0.01 && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">Payment at the desk</p>
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <input type="number" min={0} step="0.01" className={field} value={r.amount} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <select className={field} value={r.method} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, method: e.target.value as Method } : x)))}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input className={field} placeholder={r.method === "MPESA_RECEIPT" ? "M-Pesa code" : "Reference"} value={r.reference} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
              <button className="text-xs text-red-400" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button className={ghostBtn} onClick={() => setRows((rs) => [...rs, { method: "CASH", amount: left > 0 ? left.toFixed(2) : "", reference: "" }])}>+ Another payment</button>
          <p className={`text-sm ${settled ? "text-green-500" : "text-amber-500"}`}>{settled ? "The bill is covered." : left > 0 ? `${kes(left)} still to pay.` : `${kes(-left)} too much.`}</p>
        </div>
      )}
      {!settled && folio && (
        <label className="block text-sm">
          {isManager ? "Leave the balance anyway - reason" : "Only a manager can leave a balance"}
          <input disabled={!isManager} className={field} placeholder="e.g. The company will pay by cheque" value={leave} onChange={(e) => setLeave(e.target.value)} />
        </label>
      )}
      <p className="text-xs text-secondary-500">Checking out makes the sale for the room nights (so the room income reaches your Sales, Reports and VAT) and sends the room to housekeeping.</p>
      <button className={primaryBtn} disabled={busy || !folio || (!settled && !canLeave)} onClick={() => void go()}>{busy ? "Checking out..." : "Check out"}</button>
    </Modal>
  );
}

// ── Move room ───────────────────────────────────────────────────────────

export function MovePanel({ booking, board, onClose, onDone }: { booking: DeskBooking; board: Board; onClose: () => void; onDone: (message: string) => void }) {
  const mine = board.rooms.filter((r) => r.guest?.bookingId === booking.id);
  const free = board.rooms.filter((r) => r.roomTypeId === booking.roomTypeId && r.status === "VACANT_CLEAN");
  const [from, setFrom] = useState(mine[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canMove = useMemo(() => from && to && reason.trim().length >= 3, [from, to, reason]);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/hotel/bookings/${booking.id}/move-room`, { fromRoomId: from, toRoomId: to, reason: reason.trim() });
      onDone(`${booking.guestName} moved.`);
    } catch (err) {
      setError(explain(err, "Could not move the guest."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Move ${booking.guestName}`} onClose={onClose}>
      <Msg error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">From<select className={field} value={from} onChange={(e) => setFrom(e.target.value)}>{mine.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}</select></label>
        <label className="text-sm">To<select className={field} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a clean room</option>{free.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}</select></label>
      </div>
      <input className={field} placeholder="Why? (e.g. air conditioning broken)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className={primaryBtn} disabled={busy || !canMove} onClick={() => void go()}>{busy ? "Moving..." : "Move the guest"}</button>
    </Modal>
  );
}
