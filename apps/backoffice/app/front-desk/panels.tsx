"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { addDays, field, ghostBtn, kes, METHOD_LABEL, primaryBtn, today, type Board, type DeskBooking, type Folio, type Room, type RoomType } from "./types";

const explain = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** A centred box over the page. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

const Msg = ({ error }: { error: string | null }) => (error ? <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{error}</p> : null);

type Method = "CASH" | "MPESA_RECEIPT" | "CARD";
const METHODS: [Method, string][] = [
  ["CASH", "Cash"],
  ["MPESA_RECEIPT", "M-Pesa (receipt code)"],
  ["CARD", "Card"],
];

// ── A new booking ───────────────────────────────────────────────────────

export function NewBookingPanel({ types, rooms, isManager, onClose, onDone }: { types: RoomType[]; rooms: Room[]; isManager: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [f, setF] = useState({ guestName: "", phone: "", idNumber: "", nationality: "", email: "", guests: "1", checkIn: today(), checkOut: addDays(today(), 1), roomTypeId: types[0]?.id ?? "", roomId: "", rate: "", source: "FRONT_DESK", notes: "" });
  const [dep, setDep] = useState({ amount: "", method: "CASH" as Method, reference: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = types.find((t) => t.id === f.roomTypeId);
  const roomsOfType = rooms.filter((r) => r.roomTypeId === f.roomTypeId && r.status !== "OUT_OF_ORDER");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const nights = Math.max(0, Math.round((new Date(f.checkOut).getTime() - new Date(f.checkIn).getTime()) / 86_400_000));
  const rate = f.rate ? Number(f.rate) : (type?.pricePerNight ?? 0);

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
        guests: Number(f.guests),
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
          <label className="text-sm">Guest name<input required className={field} value={f.guestName} onChange={(e) => set("guestName", e.target.value)} /></label>
          <label className="text-sm">Phone<input required className={field} inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0712 345 678" /></label>
          <label className="text-sm">ID / passport number<input className={field} value={f.idNumber} onChange={(e) => set("idNumber", e.target.value)} /></label>
          <label className="text-sm">Nationality<input className={field} value={f.nationality} onChange={(e) => set("nationality", e.target.value)} /></label>
          <label className="text-sm">Arrives<input required type="date" min={today()} className={field} value={f.checkIn} onChange={(e) => set("checkIn", e.target.value)} /></label>
          <label className="text-sm">Leaves<input required type="date" min={addDays(f.checkIn, 1)} className={field} value={f.checkOut} onChange={(e) => set("checkOut", e.target.value)} /></label>
          <label className="text-sm">Room type
            <select required className={field} value={f.roomTypeId} onChange={(e) => { set("roomTypeId", e.target.value); set("roomId", ""); }}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name} - {kes(t.pricePerNight)} a night</option>)}
            </select>
          </label>
          <label className="text-sm">A particular room <span className="text-secondary-500">(optional)</span>
            <select className={field} value={f.roomId} onChange={(e) => set("roomId", e.target.value)}>
              <option value="">Any</option>
              {roomsOfType.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
            </select>
          </label>
          <label className="text-sm">Guests<input required type="number" min={1} max={type?.maxGuests ?? 10} className={field} value={f.guests} onChange={(e) => set("guests", e.target.value)} /></label>
          <label className="text-sm">Booked by<select className={field} value={f.source} onChange={(e) => set("source", e.target.value)}><option value="FRONT_DESK">Walk-in</option><option value="PHONE">Phone</option></select></label>
          {isManager && (
            <label className="text-sm sm:col-span-2">Rate per night <span className="text-secondary-500">(leave empty for {type ? kes(type.pricePerNight) : "the usual price"}; a change is logged)</span>
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
        <p className="text-sm text-secondary-500">{nights} night{nights === 1 ? "" : "s"} at {kes(rate)} = {kes(rate * nights)} before VAT.</p>
        <button disabled={busy || !f.roomTypeId} className={primaryBtn}>{busy ? "Booking..." : "Make the booking"}</button>
      </form>
    </Modal>
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
        <p className="flex justify-between"><span>Room nights (VAT {kes(folio.totals.roomTax)} inside)</span><span className="font-mono">{kes(folio.totals.roomNights)}</span></p>
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
