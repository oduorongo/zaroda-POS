"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../../lib/api";

type Status = "PENDING_PAYMENT" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" | "EXPIRED" | "NO_SHOW";

interface Booking {
  id: string;
  bookingNumber: string;
  status: Status;
  guestName: string;
  guestPhone: string;
  guestEmail: string | null;
  guests: number;
  rooms: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  notes: string | null;
  roomTypeName: string;
  total: number;
  depositAmount: number;
  depositPaid: number;
  balanceDue: number;
  mpesaReceiptNumber: string | null;
  lastPaymentError: string | null;
  cancelReason: string | null;
}

const LABEL: Record<Status, string> = {
  PENDING_PAYMENT: "Waiting for deposit",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "In the house",
  CHECKED_OUT: "Checked out",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  NO_SHOW: "No-show",
};
const TONE: Record<Status, string> = {
  PENDING_PAYMENT: "bg-amber-500/15 text-amber-600",
  CONFIRMED: "bg-green-600/15 text-green-600",
  CHECKED_IN: "bg-blue-500/15 text-blue-500",
  CHECKED_OUT: "bg-secondary-500/15 text-secondary-500",
  CANCELLED: "bg-red-500/15 text-red-500",
  EXPIRED: "bg-secondary-500/15 text-secondary-500",
  NO_SHOW: "bg-red-500/15 text-red-500",
};

const input = "rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });

/** Who is booked, who is arriving, who is in the house. Check-in and check-out, cancelling, and confirming a deposit by hand. */
export function BookingsSection() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [reason, setReason] = useState("");
  const [paying, setPaying] = useState<Booking | null>(null);
  const [receipt, setReceipt] = useState("");

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);
  async function load() {
    try {
      setBookings(await apiGet<Booking[]>(`/hotel/bookings${showPast ? "?includePast=true" : ""}`));
    } catch (err) {
      fail(err, "Could not load the bookings.");
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPast]);

  async function act(key: string, path: string, body: unknown, done: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await apiPost(path, body);
      setNotice(done);
      await load();
    } catch (err) {
      fail(err, "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (bookings === null) return <p className="text-sm text-secondary-500">{error ?? "Loading..."}</p>;

  const arriving = bookings.filter((b) => b.status === "CONFIRMED").length;
  const inHouse = bookings.filter((b) => b.status === "CHECKED_IN").length;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-md border border-border bg-surface px-3 py-2">
          <strong>{arriving}</strong> confirmed, still to arrive
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-2">
          <strong>{inHouse}</strong> in the house
        </span>
        <label className="ml-auto flex items-center gap-2 text-secondary-500">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Include past bookings
        </label>
      </div>

      {bookings.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No bookings yet. They appear here as soon as a guest books a room on the marketplace.</p>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div key={b.id} className="space-y-2 rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {b.guestName} <span className="font-mono text-xs text-secondary-500">{b.bookingNumber}</span>
                  </p>
                  <p className="text-sm text-secondary-600">
                    {b.roomTypeName}
                    {b.rooms > 1 ? ` x ${b.rooms}` : ""} · {shortDay(b.checkIn)} to {shortDay(b.checkOut)} ({b.nights} night{b.nights === 1 ? "" : "s"}) · {b.guests} guest{b.guests === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-secondary-500">
                    <a href={`tel:+${b.guestPhone}`} className="underline">
                      {b.guestPhone}
                    </a>
                    {b.guestEmail ? ` · ${b.guestEmail}` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[b.status]}`}>{LABEL[b.status]}</span>
              </div>
              <p className="text-sm">
                Total {kes(b.total)} · deposit {b.depositPaid > 0 ? `${kes(b.depositPaid)} paid` : `${kes(b.depositAmount)} not yet paid`} · <strong>balance to collect {kes(b.balanceDue)}</strong>
                {b.mpesaReceiptNumber && <span className="text-xs text-secondary-500"> (M-Pesa {b.mpesaReceiptNumber})</span>}
              </p>
              {b.notes && <p className="text-xs text-secondary-500">Guest note: {b.notes}</p>}
              {b.lastPaymentError && <p className="rounded-md bg-amber-950 p-2 text-xs text-amber-200">{b.lastPaymentError}</p>}
              {b.cancelReason && <p className="text-xs text-secondary-500">Reason: {b.cancelReason}</p>}
              <div className="flex flex-wrap gap-2">
                {b.status === "CONFIRMED" && (
                  <>
                    <a className={button} href="/front-desk">
                      Check in at the front desk
                    </a>
                    <button className={ghost} disabled={busy !== null} onClick={() => window.confirm(`Mark ${b.guestName} as a no-show?`) && void act(`n-${b.id}`, `/hotel/bookings/${b.id}/no-show`, {}, "Marked as a no-show.")}>
                      No-show
                    </button>
                  </>
                )}
                {b.status === "CHECKED_IN" && (
                  <a className={button} href="/front-desk">
                    Check out at the front desk
                  </a>
                )}
                {b.status === "PENDING_PAYMENT" && (
                  <button className={ghost} onClick={() => { setPaying(b); setReceipt(""); }}>
                    Deposit paid? Enter the M-Pesa code
                  </button>
                )}
                {(b.status === "PENDING_PAYMENT" || b.status === "CONFIRMED") && (
                  <button className={ghost} onClick={() => { setCancelling(b); setReason(""); }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {cancelling && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="font-semibold">Cancel {cancelling.guestName}&apos;s booking</h3>
          {cancelling.depositPaid > 0 && <p className="text-sm text-amber-600">They paid a deposit of {kes(cancelling.depositPaid)} to your own account - you will need to refund it to them.</p>}
          <input className={`${input} w-full`} placeholder="Reason (the guest sees this)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button className={button} disabled={busy !== null || reason.trim().length < 3} onClick={() => { void act(`c-${cancelling.id}`, `/hotel/bookings/${cancelling.id}/cancel`, { reason: reason.trim() }, "Booking cancelled."); setCancelling(null); }}>
              Cancel the booking
            </button>
            <button className={ghost} onClick={() => setCancelling(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {paying && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="font-semibold">Confirm {paying.guestName}&apos;s deposit by hand</h3>
          <p className="text-sm text-secondary-500">Use this only when you can see the M-Pesa message for {kes(paying.depositAmount)} but the booking did not confirm by itself.</p>
          <input className={`${input} w-full`} placeholder="M-Pesa confirmation code, e.g. QAB1CD2EF3" value={receipt} onChange={(e) => setReceipt(e.target.value)} />
          <div className="flex gap-2">
            <button className={button} disabled={busy !== null || receipt.trim().length < 6} onClick={() => { void act(`p-${paying.id}`, `/hotel/bookings/${paying.id}/confirm-payment`, { receipt: receipt.trim() }, "Deposit confirmed."); setPaying(null); }}>
              Confirm deposit
            </button>
            <button className={ghost} onClick={() => setPaying(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
