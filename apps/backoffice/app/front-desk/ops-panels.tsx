"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../lib/api";
import { explain, METHODS, Modal, Msg, type Method } from "./panels";
import { addDays, field, ghostBtn, kes, MEAL_LABEL, primaryBtn, today, type Board, type DeskBooking, type MealPlan, type RoomType } from "./types";

interface AmendPreview {
  before: { checkIn: string; checkOut: string; nights: number; rooms: number; roomTypeName: string; total: number };
  after: { checkIn: string; checkOut: string; nights: number; rooms: number; roomTypeName: string; total: number };
  difference: number;
  repricedWholeStay: boolean;
  flatRateDropped: boolean;
}

// ── Change a stay: extend, shorten, new dates, rooms, room type, guests, meals ──

export function ChangeStayPanel({ booking, types, board, isManager, onClose, onDone }: { booking: DeskBooking; types: RoomType[]; board: Board; isManager: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const inHouse = booking.status === "CHECKED_IN";
  const [f, setF] = useState({ checkIn: booking.checkIn, checkOut: booking.checkOut, rooms: String(booking.rooms), adults: String(booking.adults), children: String(booking.children), mealPlan: booking.mealPlan as MealPlan, roomTypeId: booking.roomTypeId, rate: "", reason: "" });
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<AmendPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPreview(null);
  };
  const roomsChange = Number(f.rooms) !== booking.rooms || f.roomTypeId !== booking.roomTypeId;
  const needsRooms = inHouse && roomsChange;
  // rooms the guest could be in afterwards: the ones they are in already (if the type stays), or clean vacant ones of the type
  const candidates = board.rooms.filter((r) => r.roomTypeId === f.roomTypeId && (r.status === "VACANT_CLEAN" || (f.roomTypeId === booking.roomTypeId && r.guest?.bookingId === booking.id)));

  useEffect(() => setRoomIds([]), [f.roomTypeId, f.rooms]);

  const body = (dryRun: boolean) => ({
    checkIn: inHouse ? undefined : f.checkIn,
    checkOut: f.checkOut,
    rooms: Number(f.rooms),
    adults: Number(f.adults),
    children: Number(f.children),
    mealPlan: f.mealPlan,
    roomTypeId: f.roomTypeId !== booking.roomTypeId ? f.roomTypeId : undefined,
    rate: isManager && f.rate ? Number(f.rate) : undefined,
    roomIds: needsRooms ? roomIds : undefined,
    reason: f.reason.trim(),
    dryRun,
  });

  async function look() {
    setBusy(true);
    setError(null);
    try {
      setPreview((await apiPost<{ preview: AmendPreview }>(`/hotel/bookings/${booking.id}/amend`, body(true))).preview);
    } catch (err) {
      setError(explain(err, "Could not work out the new price."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/hotel/bookings/${booking.id}/amend`, body(false));
      onDone(`${booking.guestName}'s stay was changed.`);
    } catch (err) {
      setError(explain(err, "Could not change the stay."));
    } finally {
      setBusy(false);
    }
  }

  const reasonOk = f.reason.trim().length >= 3;
  return (
    <Modal title={`Change ${booking.guestName}'s stay`} onClose={onClose}>
      <Msg error={error} />
      <p className="text-sm text-secondary-500">{booking.roomTypeName} · {booking.checkIn} to {booking.checkOut} · {kes(booking.total)}{inHouse ? " · in the house (the arrival date cannot change; leaving early takes nights off, staying longer adds them)" : ""}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Arrives<input type="date" disabled={inHouse} min={today()} className={field} value={f.checkIn} onChange={(e) => set("checkIn", e.target.value)} /></label>
        <label className="text-sm">Leaves<input type="date" min={inHouse ? today() : addDays(f.checkIn, 1)} className={field} value={f.checkOut} onChange={(e) => set("checkOut", e.target.value)} /></label>
        <label className="text-sm">Room type
          <select className={field} value={f.roomTypeId} onChange={(e) => set("roomTypeId", e.target.value)}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Rooms<input type="number" min={1} max={5} className={field} value={f.rooms} onChange={(e) => set("rooms", e.target.value)} /></label>
        <label className="text-sm">Adults<input type="number" min={1} className={field} value={f.adults} onChange={(e) => set("adults", e.target.value)} /></label>
        <label className="text-sm">Children<input type="number" min={0} className={field} value={f.children} onChange={(e) => set("children", e.target.value)} /></label>
        <label className="text-sm">Meals
          <select className={field} value={f.mealPlan} onChange={(e) => set("mealPlan", e.target.value)}>
            {(Object.keys(MEAL_LABEL) as MealPlan[]).map((k) => <option key={k} value={k}>{MEAL_LABEL[k]}</option>)}
          </select>
        </label>
        {isManager && <label className="text-sm">Flat rate per night <span className="text-secondary-500">(optional, logged)</span><input type="number" min={1} step="0.01" className={field} value={f.rate} onChange={(e) => set("rate", e.target.value)} /></label>}
      </div>
      {needsRooms && (
        <div className="space-y-1 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">Which {f.rooms} room{Number(f.rooms) === 1 ? "" : "s"} will the guest be in?</p>
          <div className="flex flex-wrap gap-2">
            {candidates.map((r) => {
              const on = roomIds.includes(r.id);
              return (
                <button key={r.id} type="button" onClick={() => setRoomIds((c) => (on ? c.filter((x) => x !== r.id) : [...c, r.id]))} className={`rounded-md border px-3 py-2 text-sm ${on ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
                  Room {r.number}
                </button>
              );
            })}
            {candidates.length === 0 && <p className="text-sm text-amber-500">No clean, vacant room of that type right now.</p>}
          </div>
        </div>
      )}
      <input className={field} placeholder="Why? (kept in the audit log)" value={f.reason} onChange={(e) => set("reason", e.target.value)} />
      {preview && (
        <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p>{preview.before.nights} night{preview.before.nights === 1 ? "" : "s"} × {preview.before.rooms} → <strong>{preview.after.nights} night{preview.after.nights === 1 ? "" : "s"} × {preview.after.rooms}</strong> ({preview.after.roomTypeName}, {preview.after.checkIn} to {preview.after.checkOut})</p>
          <p className="flex justify-between"><span>Price before tax</span><span className="font-mono">{kes(preview.before.total)} → {kes(preview.after.total)}</span></p>
          <p className={`font-semibold ${preview.difference > 0 ? "text-amber-500" : preview.difference < 0 ? "text-green-500" : ""}`}>{preview.difference === 0 ? "No change in price." : preview.difference > 0 ? `${kes(preview.difference)} more` : `${kes(-preview.difference)} less`} (tax comes on top)</p>
          <p className="text-xs text-secondary-500">{preview.repricedWholeStay ? "The whole stay is priced again from today's price list." : "Nights already agreed keep their price; only new nights use today's price."}{preview.flatRateDropped ? " The earlier flat rate does not carry over to another room type." : ""}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={ghostBtn} disabled={busy || !reasonOk || (needsRooms && roomIds.length !== Number(f.rooms))} onClick={() => void look()}>See the new price</button>
        <button className={primaryBtn} disabled={busy || !reasonOk || !preview || (needsRooms && roomIds.length !== Number(f.rooms))} onClick={() => void save()}>{busy ? "Saving..." : "Save the change"}</button>
      </div>
    </Modal>
  );
}

// ── Cancel (or no-show) under the hotel's policy ──

interface CancelPreview {
  policy: { freeDays: number; keepPercent: number };
  arrival: string;
  daysBefore: number;
  withinFreeWindow: boolean;
  paid: number;
  feeKept: number;
  refundDue: number;
  waived: boolean;
}

export function CancelPanel({ booking, isManager, noShow, onClose, onDone }: { booking: DeskBooking; isManager: boolean; noShow: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [waive, setWaive] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [result, setResult] = useState<{ refundDue: number; feeKept: number } | null>(null);
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (result) return;
    apiGet<CancelPreview>(`/hotel/bookings/${booking.id}/cancellation-preview?waive=${waive}`).then(setPreview).catch((e) => setError(explain(e, "Could not work out the cancellation.")));
  }, [booking.id, waive, result]);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ refundDue: number; feeKept: number }>(`/hotel/bookings/${booking.id}/${noShow ? "no-show" : "cancel"}`, { reason: reason.trim() || (noShow ? undefined : ""), waiveFee: waive || undefined });
      setResult(r);
    } catch (err) {
      setError(explain(err, "Could not cancel."));
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ refunded: number }>(`/hotel/bookings/${booking.id}/cancellation-refund`, { method, reference: reference || undefined });
      onDone(`${noShow ? "No-show" : "Cancellation"} recorded and ${kes(r.refunded)} refunded to ${booking.guestName}.`);
    } catch (err) {
      setError(explain(err, "Could not record the refund."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${noShow ? "Mark a no-show:" : "Cancel"} ${booking.guestName}`} onClose={result ? () => onDone(`${noShow ? "No-show" : "Cancellation"} recorded.`) : onClose}>
      <Msg error={error} />
      {!result && preview && (
        <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p className="text-secondary-500">Policy: free until {preview.policy.freeDays} day{preview.policy.freeDays === 1 ? "" : "s"} before arrival; later, {preview.policy.keepPercent}% of what was paid is kept.</p>
          <p>Arrival {preview.arrival} ({preview.daysBefore >= 0 ? `${preview.daysBefore} day${preview.daysBefore === 1 ? "" : "s"} away` : "already passed"}) — {preview.withinFreeWindow ? "inside the free period" : "after the free period"}.</p>
          <p className="flex justify-between"><span>Paid so far</span><span className="font-mono">{kes(preview.paid)}</span></p>
          <p className="flex justify-between"><span>The hotel keeps</span><span className="font-mono">{kes(preview.feeKept)}</span></p>
          <p className="flex justify-between text-base font-bold"><span>To refund the guest</span><span className="font-mono">{kes(preview.refundDue)}</span></p>
        </div>
      )}
      {!result && (
        <>
          {isManager && !preview?.withinFreeWindow && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> Waive the fee (e.g. the hotel&apos;s own fault) - logged</label>
          )}
          <input className={field} placeholder={noShow ? "Note (optional)" : "Why? (kept in the audit log)"} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className={primaryBtn} disabled={busy || (!noShow && reason.trim().length < 3)} onClick={() => void go()}>{busy ? "Saving..." : noShow ? "Mark as a no-show" : "Cancel the booking"}</button>
        </>
      )}
      {result && (
        <div className="space-y-2">
          <p className="rounded-md bg-green-950 p-2 text-sm text-green-300">Done. The hotel keeps {kes(result.feeKept)}; {kes(result.refundDue)} is owed back to the guest, who has been texted.</p>
          {result.refundDue > 0 && isManager && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">Hand the refund back now</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className={field} value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input className={field} placeholder={method === "MPESA_RECEIPT" ? "M-Pesa reference (needed)" : "Slip / reference"} value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <button className={primaryBtn} disabled={busy || (method === "MPESA_RECEIPT" && !reference)} onClick={() => void refund()}>Record the {kes(result.refundDue)} refund</button>
              <p className="text-xs text-secondary-500">Or leave it: it stays on the Cancellations report until you record it.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Close the day ──

interface AuditSummary {
  date: string;
  rooms: { total: number; occupied: number; occupancyPercent: number };
  arrivals: { expected: number; arrived: number; noShows: { bookingNumber: string; guestName: string }[]; stillExpectedPaid: { bookingNumber: string; guestName: string; paid: number }[] };
  departures: { due: number; left: number };
  overstays: { bookingNumber: string; guestName: string; nights: number; charged: number }[];
  money: { roomRevenue: number; roomTax: number; paymentsReceived: number; refundsGiven: number; outstandingInHouse: number };
}

export function NightAuditPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(today());
  const [result, setResult] = useState<{ alreadyRun: boolean; summary: AuditSummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await apiPost(`/hotel/night-audit`, { date }));
    } catch (err) {
      setError(explain(err, "Could not close the day."));
    } finally {
      setBusy(false);
    }
  }

  const s = result?.summary;
  return (
    <Modal title="Close the day (night audit)" onClose={result ? onDone : onClose}>
      <Msg error={error} />
      <p className="text-sm text-secondary-500">Charges guests who stayed past their check-out date, marks arrivals who never came (and paid nothing) as no-shows, and writes the day&apos;s summary. Doing it twice for one day changes nothing. It also runs by itself at the hour set in Rates &amp; rules.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Day to close<input type="date" max={today()} className={field} value={date} onChange={(e) => { setDate(e.target.value); setResult(null); }} /></label>
        <button className={primaryBtn} disabled={busy} onClick={() => void run()}>{busy ? "Closing..." : "Close this day"}</button>
      </div>
      {result && s && (
        <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold">{result.alreadyRun ? "This day was already closed - here is its summary." : "Day closed."} {s.date}</p>
          <p>Rooms occupied: <strong>{s.rooms.occupied}</strong> of {s.rooms.total} ({s.rooms.occupancyPercent}%)</p>
          <p>Arrivals: {s.arrivals.arrived} of {s.arrivals.expected} came · Departures: {s.departures.left} of {s.departures.due} left</p>
          {s.overstays.length > 0 && <p>Stayed past check-out and charged: {s.overstays.map((o) => `${o.guestName} (${o.nights} night${o.nights === 1 ? "" : "s"}, ${kes(o.charged)})`).join(", ")}</p>}
          {s.arrivals.noShows.length > 0 && <p>Marked no-show: {s.arrivals.noShows.map((n) => n.guestName).join(", ")}</p>}
          {s.arrivals.stillExpectedPaid.length > 0 && <p className="text-amber-500">Paid but did not arrive (decide yourself): {s.arrivals.stillExpectedPaid.map((n) => `${n.guestName} (${kes(n.paid)})`).join(", ")}</p>}
          <p>Room income before tax {kes(s.money.roomRevenue)} · tax {kes(s.money.roomTax)} · payments {kes(s.money.paymentsReceived)} · refunds {kes(s.money.refundsGiven)}</p>
          <p>Guests in the house still owe {kes(s.money.outstandingInHouse)}.</p>
        </div>
      )}
    </Modal>
  );
}
