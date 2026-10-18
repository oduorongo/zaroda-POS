"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BedDouble, CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { ApiError, checkBooking, getBooking, retryBooking } from "../lib/api";
import { displayPhone, kes } from "../lib/format";
import type { RoomBooking } from "../lib/types";

const BOOKINGS_KEY = "zaroda_room_bookings";
const POLL_MS = 5_000;

function savedToken(id: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(BOOKINGS_KEY) ?? "{}") as Record<string, string>)[id] ?? null;
  } catch {
    return null;
  }
}

const nice = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The page a guest lands on after booking: first the deposit prompt, then the confirmation with what is left to pay at the hotel. */
export default function BookingStatus({ bookingId }: { bookingId: string }) {
  const params = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [booking, setBooking] = useState<RoomBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitedLong, setWaitedLong] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    setToken(params.get("k") ?? savedToken(bookingId));
  }, [params, bookingId]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setBooking(await getBooking(bookingId, token));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : "Could not refresh - check your connection.");
    }
  }, [bookingId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only the payment is worth watching; once it is settled the page stays as it is.
  const waiting = booking?.status === "PENDING_PAYMENT";
  useEffect(() => {
    if (!token || !waiting) return;
    const timer = setInterval(() => {
      void load();
      if (Date.now() - startedAt.current > 45_000) setWaitedLong(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [token, waiting, load]);

  async function sendAgain() {
    if (!token) return;
    setBusy(true);
    setHint(null);
    try {
      setBooking(await retryBooking(bookingId, token));
      startedAt.current = Date.now();
      setWaitedLong(false);
      setHint("We sent the M-Pesa prompt again - check your phone.");
    } catch (err) {
      setHint(err instanceof ApiError ? err.message : "Could not send it again.");
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    if (!token) return;
    setBusy(true);
    setHint(null);
    try {
      const result = await checkBooking(bookingId, token);
      setBooking(result);
      if (result.checkResult === "not-paid-yet") setHint("Not received yet. If you have entered your PIN, wait a moment and try again.");
      if (result.checkResult === "unavailable") setHint("We could not check just now. Please call the hotel to confirm your deposit.");
    } catch (err) {
      setHint(err instanceof ApiError ? err.message : "Could not check the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-10 text-center">
        <h1 className="text-xl font-semibold">We can&apos;t find that booking</h1>
        <p className="text-secondary-600">Open this page from the same phone that made the booking, or contact the hotel with your booking number.</p>
      </div>
    );
  }
  if (!booking) return <p className="py-10 text-center text-secondary-500">{error ?? "Loading your booking..."}</p>;

  const confirmed = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(booking.status);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="rounded-xl bg-primary-600 px-5 py-4 text-white">
        <p className="text-sm text-primary-50">{booking.hotel.name}</p>
        <h1 className="text-xl font-bold">Booking {booking.bookingNumber}</h1>
      </div>

      {waiting && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Clock size={18} aria-hidden /> Check your phone and enter your M-Pesa PIN
          </p>
          <p className="text-sm text-secondary-600">
            We sent a prompt for your deposit of <strong>{kes(booking.depositAmount)}</strong> to {displayPhone(booking.paymentPhone)}. Your room is held for a few minutes while you pay, and this page updates by itself.
          </p>
          {booking.lastPaymentError && <p className="rounded-md bg-warning-50 p-2 text-sm text-warning-700">{booking.lastPaymentError}</p>}
          {hint && <p className="text-sm text-secondary-600">{hint}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void sendAgain()} disabled={busy} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">
              {waitedLong || booking.lastPaymentError ? "Send the prompt again" : "Didn't get it? Send again"}
            </button>
            {waitedLong && (
              <button onClick={() => void checkNow()} disabled={busy} className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                I&apos;ve paid - check now
              </button>
            )}
          </div>
        </div>
      )}

      {confirmed && (
        <div className="space-y-2 rounded-lg border border-success-600 bg-success-50 p-4 text-success-700">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 size={22} aria-hidden /> {booking.status === "CHECKED_OUT" ? "Thank you for staying with us" : booking.status === "CHECKED_IN" ? "Enjoy your stay" : "Your room is booked"}
          </p>
          <p className="text-sm">
            Deposit {kes(booking.depositAmount)} paid{booking.mpesaReceiptNumber ? ` (M-Pesa ${booking.mpesaReceiptNumber})` : ""}. Show your booking number <strong>{booking.bookingNumber}</strong> at the front desk.
          </p>
          {booking.lastPaymentError && <p className="rounded-md bg-warning-50 p-2 text-sm text-warning-700">{booking.lastPaymentError}</p>}
        </div>
      )}

      {booking.status === "EXPIRED" && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <p className="font-semibold">The deposit didn&apos;t come through in time</p>
          <p className="text-sm text-secondary-600">Nothing was charged and the room was released. You can book again if it&apos;s still free.</p>
          <Link href={`/hotels/${booking.hotel.slug}?checkIn=${booking.checkIn}&checkOut=${booking.checkOut}`} className="inline-block rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white">
            Book again
          </Link>
        </div>
      )}

      {(booking.status === "CANCELLED" || booking.status === "NO_SHOW") && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <p className="font-semibold">{booking.status === "NO_SHOW" ? "This booking was marked as a no-show" : "This booking was cancelled"}</p>
          {booking.cancelReason && <p className="text-sm text-secondary-600">{booking.cancelReason}</p>}
          {booking.paidAt && booking.status === "CANCELLED" && <p className="text-sm text-secondary-600">The hotel will refund your deposit of {kes(booking.depositAmount)}. Please contact them if you don&apos;t receive it.</p>}
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <BedDouble size={16} aria-hidden /> {booking.roomTypeName}
          {booking.rooms > 1 ? ` x ${booking.rooms}` : ""}
        </h2>
        <p className="flex items-center gap-2 text-sm">
          <CalendarDays size={14} aria-hidden /> {nice(booking.checkIn)} to {nice(booking.checkOut)} ({booking.nights} night{booking.nights === 1 ? "" : "s"})
        </p>
        <p className="text-sm text-secondary-600">
          {booking.guestName}, {booking.guests} guest{booking.guests === 1 ? "" : "s"}
        </p>
        <div className="space-y-1 border-t border-border pt-3 text-sm">
          <p className="flex justify-between">
            <span>Total for the stay</span>
            <span>{kes(booking.total)}</span>
          </p>
          <p className="flex justify-between">
            <span>Deposit {confirmed ? "paid" : "due now"}</span>
            <span>{kes(booking.depositAmount)}</span>
          </p>
          <p className="flex justify-between font-semibold">
            <span>Balance to pay at the hotel</span>
            <span>{kes(booking.balanceDue)}</span>
          </p>
        </div>
      </section>

      {error && <p className="text-center text-xs text-secondary-500">{error}</p>}
      <p className="text-center text-sm">
        <Link href={`/hotels/${booking.hotel.slug}`} className="text-primary-600 hover:underline">
          See {booking.hotel.name}
        </Link>
      </p>
    </div>
  );
}
