"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarClock, CheckCircle2, Clock, XCircle } from "lucide-react";
import { ApiError, cancelReservation, getReservation } from "../lib/api";
import type { Reservation } from "../lib/types";

const RESERVATIONS_KEY = "zaroda_reservations";
const POLL_MS = 15_000;

function savedToken(id: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(RESERVATIONS_KEY) ?? "{}") as Record<string, string>)[id] ?? null;
  } catch {
    return null;
  }
}

const nice = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** A guest's table request: waiting for the restaurant, then confirmed or declined. Refreshes itself while it is waiting. */
export default function ReservationStatus({ reservationId }: { reservationId: string }) {
  const params = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(params.get("k") ?? savedToken(reservationId));
  }, [params, reservationId]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setReservation(await getReservation(reservationId, token));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : "Could not refresh - check your connection.");
    }
  }, [reservationId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = reservation?.status === "REQUESTED";
  useEffect(() => {
    if (!token || !waiting) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [token, waiting, load]);

  async function cancel() {
    if (!token || !window.confirm("Cancel this table request?")) return;
    setBusy(true);
    try {
      setReservation(await cancelReservation(reservationId, token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel - please call the restaurant.");
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-10 text-center">
        <h1 className="text-xl font-semibold">We can&apos;t find that request</h1>
        <p className="text-secondary-600">Open this page from the same phone that made the request, or call the restaurant with your reference number.</p>
      </div>
    );
  }
  if (!reservation) return <p className="py-10 text-center text-secondary-500">{error ?? "Loading your request..."}</p>;

  const open = reservation.status === "REQUESTED" || reservation.status === "CONFIRMED";

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="rounded-xl bg-primary-600 px-5 py-4 text-white">
        <p className="text-sm text-primary-50">{reservation.shop.name}</p>
        <h1 className="text-xl font-bold">Table request {reservation.reservationNumber}</h1>
      </div>

      {reservation.status === "REQUESTED" && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Clock size={18} aria-hidden /> Waiting for the restaurant to confirm
          </p>
          <p className="text-sm text-secondary-600">They will text you as soon as they reply. This page also updates by itself, so you can keep it open.</p>
        </div>
      )}
      {reservation.status === "CONFIRMED" && (
        <div className="space-y-1 rounded-lg border border-success-600 bg-success-50 p-4 text-success-700">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 size={22} aria-hidden /> Your table is confirmed
          </p>
          {reservation.tableLabel && <p className="text-sm">You will be at {reservation.tableLabel}.</p>}
          {reservation.restaurantNote && <p className="text-sm">{reservation.restaurantNote}</p>}
        </div>
      )}
      {reservation.status === "SEATED" && <p className="rounded-lg border border-border bg-surface p-4 font-semibold">You have been seated. Enjoy your meal!</p>}
      {(reservation.status === "DECLINED" || reservation.status === "CANCELLED" || reservation.status === "NO_SHOW") && (
        <div className="space-y-1 rounded-lg border border-border bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold">
            <XCircle size={18} aria-hidden /> {reservation.status === "DECLINED" ? "The restaurant could not take this request" : reservation.status === "NO_SHOW" ? "This reservation was marked as missed" : "This request was cancelled"}
          </p>
          {reservation.restaurantNote && <p className="text-sm text-secondary-600">{reservation.restaurantNote}</p>}
          {reservation.status === "DECLINED" && (
            <Link href={`/s/${reservation.shop.slug}/reserve`} className="mt-2 inline-block rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white">
              Try another time
            </Link>
          )}
        </div>
      )}

      <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <p className="flex items-center gap-2 font-semibold">
          <CalendarClock size={16} aria-hidden /> {nice(reservation.date)} at {reservation.time}
        </p>
        <p className="text-sm text-secondary-600">
          {reservation.partySize} {reservation.partySize === 1 ? "person" : "people"} - {reservation.guestName}
        </p>
        {reservation.notes && <p className="text-xs text-secondary-500">Your note: {reservation.notes}</p>}
      </section>

      {open && (
        <button onClick={() => void cancel()} disabled={busy} className="w-full rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50">
          Cancel this request
        </button>
      )}
      {error && <p className="text-center text-xs text-secondary-500">{error}</p>}
      <p className="text-center text-sm">
        <Link href={`/s/${reservation.shop.slug}`} className="text-primary-600 hover:underline">
          See {reservation.shop.name}
        </Link>
      </p>
    </div>
  );
}
