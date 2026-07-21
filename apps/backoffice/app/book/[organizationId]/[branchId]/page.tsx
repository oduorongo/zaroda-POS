"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

// Deliberately does NOT import lib/auth.ts or lib/api.ts - this page is
// reachable by an actual customer with no login of any kind, so it must
// never touch the staff session (localStorage key, token, anything).
// First genuinely public-facing page in this project, so it's the first
// one that needs a build-time API URL rather than a staff member typing
// one into a login form.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

interface Resource {
  id: string;
  name: string;
}

interface BusyBlock {
  startTime: string;
  endTime: string;
}

function toLocalDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A real customer's self-service booking page - no staff involved. Talks
 * directly to the public/unauthenticated /public/salon/:organizationId/
 * :branchId/* endpoints (see apps/api/src/public-booking/) using the ids
 * embedded in this page's own URL, e.g.
 * /book/<organizationId>/<branchId> - a salon would share that link
 * directly with customers (a QR code on a receipt, a link in a bio),
 * there's no directory/search of organizations anywhere public.
 */
export default function PublicBookingPage() {
  const params = useParams<{ organizationId: string; branchId: string }>();
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState(() => toLocalDateInput(new Date()));
  const [busy, setBusy] = useState<BusyBlock[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [serviceName, setServiceName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    id: string;
    serviceName: string;
    startTime: string;
    endTime: string;
    resourceName: string;
    cancelToken: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/public/salon/${params.organizationId}/${params.branchId}/resources`);
        if (!res.ok) throw new Error();
        const list = (await res.json()) as Resource[];
        setResources(list);
        setResourceId(list[0]?.id ?? "");
      } catch {
        setLoadError("Could not load this business's booking page - the link may be incorrect.");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.organizationId, params.branchId]);

  useEffect(() => {
    if (!resourceId || !date) return;
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/public/salon/${params.organizationId}/${params.branchId}/availability?resourceId=${resourceId}&date=${date}`,
        );
        if (!res.ok) throw new Error();
        setBusy(await res.json());
      } catch {
        setBusy([]);
      }
    })();
  }, [resourceId, date, params.organizationId, params.branchId]);

  const busyToday = useMemo(
    () =>
      busy.map((b) => ({
        start: new Date(b.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        end: new Date(b.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })),
    [busy],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resourceId || !startTime) return;
    const start = new Date(`${date}T${startTime}:00`);
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    setSubmitBusy(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/public/salon/${params.organizationId}/${params.branchId}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          serviceName: serviceName.trim(),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.message === "string" ? json.message : "Booking failed");
      setConfirmed({
        id: json.id,
        serviceName: json.serviceName,
        startTime: json.startTime,
        endTime: json.endTime,
        resourceName: json.resource?.name ?? "",
        cancelToken: json.cancelToken,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Booking failed - try again");
    } finally {
      setSubmitBusy(false);
    }
  }

  if (confirmed) {
    const manageHref = `/book/manage/${params.organizationId}/${params.branchId}/${confirmed.id}?token=${confirmed.cancelToken}`;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4 text-slate-100">
        <div className="w-full max-w-md space-y-3 rounded-xl bg-slate-800 p-6 text-center shadow-xl">
          <h1 className="text-2xl font-bold text-green-400">Booking confirmed</h1>
          <p>{confirmed.serviceName}</p>
          <p className="text-slate-400">
            {new Date(confirmed.startTime).toLocaleString()} - {new Date(confirmed.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="text-sm text-slate-500">{confirmed.resourceName}</p>
          <div className="mt-4 rounded-md bg-slate-900 p-3 text-left">
            <p className="text-xs text-slate-400">
              Save this link to view or cancel your booking later - it isn&apos;t emailed or texted anywhere, this is
              the only place it&apos;s shown:
            </p>
            <a href={manageHref} className="mt-1 block break-all text-xs text-blue-400 hover:underline">
              {typeof window !== "undefined" ? `${window.location.origin}${manageHref}` : manageHref}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">Book an appointment</h1>
        {loading && <p className="mt-4 text-slate-400">Loading...</p>}
        {loadError && <p className="mt-4 rounded-md bg-red-950 p-2.5 text-sm text-red-300">{loadError}</p>}

        {!loading && !loadError && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">With</label>
              <select
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
              >
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Date</label>
              <input
                type="date"
                min={toLocalDateInput(new Date())}
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {busyToday.length > 0 && (
              <div className="rounded-md bg-slate-900 p-2.5 text-xs text-slate-400">
                Already booked today: {busyToday.map((b) => `${b.start}-${b.end}`).join(", ")}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-300">Start time</label>
                <input
                  type="time"
                  required
                  className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">Duration</label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                >
                  {[30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">Service</label>
              <input
                required
                placeholder="e.g. Haircut"
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Your name</label>
              <input
                required
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Your phone</label>
              <input
                required
                type="tel"
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>

            {submitError && <p className="rounded-md bg-red-950 p-2.5 text-sm text-red-300">{submitError}</p>}

            <button
              type="submit"
              disabled={submitBusy || !resourceId}
              className="w-full rounded-md bg-blue-600 p-3 text-lg font-semibold hover:bg-blue-500 disabled:opacity-50"
            >
              {submitBusy ? "Booking..." : "Book"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
