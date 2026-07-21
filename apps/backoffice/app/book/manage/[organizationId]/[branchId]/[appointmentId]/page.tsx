"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

// Same rule as app/book/[organizationId]/[branchId]/page.tsx: no
// lib/auth.ts or lib/api.ts import, ever - this page is reachable by an
// actual customer with no login, holding nothing but the link they were
// shown once at booking time.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

interface Booking {
  id: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  status: string;
  resource: { name: string };
}

/**
 * The other half of the public booking flow: view/cancel a booking using
 * the token shown exactly once on the confirmation screen
 * (app/book/[organizationId]/[branchId]/page.tsx). The token is the
 * actual credential here, not the appointmentId in the URL - see
 * PublicBookingService.getBooking/cancelBooking's own comment on why a
 * wrong token 404s the same way a made-up appointmentId would.
 */
export default function ManageBookingPage() {
  const params = useParams<{ organizationId: string; branchId: string; appointmentId: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/public/salon/${params.organizationId}/${params.branchId}/appointments/${params.appointmentId}?token=${encodeURIComponent(token)}`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.message === "string" ? json.message : "Could not load this booking");
      setBooking(json as Booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this booking - check the link and try again");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      setError("This link is missing its access token - use the exact link you were shown when you booked.");
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.organizationId, params.branchId, params.appointmentId, token]);

  async function handleCancel() {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/public/salon/${params.organizationId}/${params.branchId}/appointments/${params.appointmentId}/cancel`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.message === "string" ? json.message : "Could not cancel this booking");
      setBooking(json as Booking);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Could not cancel this booking - try again");
    } finally {
      setCancelBusy(false);
    }
  }

  const canCancel = booking?.status === "SCHEDULED" || booking?.status === "CONFIRMED";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4 text-slate-100">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-slate-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">Your booking</h1>
        {loading && <p className="text-slate-400">Loading...</p>}
        {error && <p className="rounded-md bg-red-950 p-2.5 text-sm text-red-300">{error}</p>}

        {booking && (
          <>
            <p className="text-lg">{booking.serviceName}</p>
            <p className="text-slate-400">
              {new Date(booking.startTime).toLocaleString()} -{" "}
              {new Date(booking.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-sm text-slate-500">{booking.resource.name}</p>
            <p className="text-sm uppercase tracking-wide text-amber-400">{booking.status.replace("_", " ")}</p>

            {cancelError && <p className="rounded-md bg-red-950 p-2.5 text-sm text-red-300">{cancelError}</p>}

            {canCancel ? (
              <button
                onClick={() => void handleCancel()}
                disabled={cancelBusy}
                className="w-full rounded-md bg-red-700 p-3 font-semibold hover:bg-red-600 disabled:opacity-50"
              >
                {cancelBusy ? "Cancelling..." : "Cancel this booking"}
              </button>
            ) : (
              <p className="text-sm text-slate-500">
                {booking.status === "CANCELLED"
                  ? "This booking has been cancelled."
                  : "This booking can no longer be changed online - contact the business directly."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
