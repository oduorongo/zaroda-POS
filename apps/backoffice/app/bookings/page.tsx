"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Branch {
  id: string;
  name: string;
}

type AppointmentStatus = "SCHEDULED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

interface Appointment {
  id: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  resource: { name: string };
  customer: { name: string } | null;
}

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED: "text-slate-400",
  CONFIRMED: "text-blue-400",
  IN_PROGRESS: "text-amber-400",
  COMPLETED: "text-green-400",
  CANCELLED: "text-red-400",
  NO_SHOW: "text-red-400",
};

/**
 * Read-only overview for the salon vertical - booking/checkout itself
 * stays on the terminal PWA (app/salon), same "manager overview, not the
 * working screen" split as the restaurant back-office page. Redirects
 * away if this org isn't SALON.
 */
export default function BookingsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (s.industryType !== "SALON") {
      router.replace("/sales");
      return;
    }
    setSessionState(s);
    void (async () => {
      try {
        const branchList = await apiGet<Branch[]>("/branches");
        setBranches(branchList);
        setBranchId(branchList[0]?.id ?? "");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load branches.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!session || !branchId) return;
    void (async () => {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
        setAppointments(
          await apiGet<Appointment[]>(
            `/salon/appointments?branchId=${branchId}&from=${startOfDay.toISOString()}&to=${endOfDay.toISOString()}`,
          ),
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load bookings.");
      }
    })();
  }, [session, branchId]);

  if (!session) return null;

  const sorted = [...appointments].sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Today&apos;s bookings</h1>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}
        {!loading && sorted.length === 0 && !error && <p className="text-slate-400">No bookings today.</p>}

        <div className="space-y-2">
          {sorted.map((a) => (
            <div key={a.id} className="rounded-lg border border-slate-800 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {a.serviceName} · {a.resource.name}
                  </p>
                  <p className="text-sm text-slate-400">
                    {new Date(a.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -{" "}
                    {new Date(a.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {a.customer && ` · ${a.customer.name}`}
                  </p>
                </div>
                <span className={`text-xs uppercase tracking-wide ${STATUS_COLOR[a.status]}`}>{a.status.replace("_", " ")}</span>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
