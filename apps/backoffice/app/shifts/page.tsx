"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Shift {
  id: string;
  branchId: string;
  terminalId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: string;
  countedCash: string | null;
  variance: string | null;
}

/**
 * Read-only in the back office - opening/closing a shift is deliberately
 * the cashier's own self-service action at the terminal (see
 * shifts.controller.ts's comment: "not a management-only view"), and the
 * terminal PWA doesn't have that UI yet either (a separate, real gap).
 * This screen is for reviewing what already happened - cash
 * reconciliation across shifts/cashiers/days.
 */
export default function ShiftsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [openOnly, setOpenOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!session) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, openOnly]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<Shift[]>(`/shifts${openOnly ? "?open=true" : ""}`);
      setShifts(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load shifts.");
    } finally {
      setLoading(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Shifts</h1>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open only
          </label>
        </div>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}
        {!loading && shifts.length === 0 && !error && <p className="text-slate-400">No shifts found.</p>}

        {shifts.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="p-3">Opened</th>
                  <th className="p-3">Closed</th>
                  <th className="p-3 text-right">Opening float (KES)</th>
                  <th className="p-3 text-right">Variance (KES)</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => (
                  <tr key={shift.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="p-3">{new Date(shift.openedAt).toLocaleString()}</td>
                    <td className="p-3">{shift.closedAt ? new Date(shift.closedAt).toLocaleString() : <span className="text-amber-400">Open</span>}</td>
                    <td className="p-3 text-right font-mono">{Number(shift.openingFloat).toFixed(2)}</td>
                    <td className="p-3 text-right font-mono">
                      {shift.variance === null ? "—" : Number(shift.variance).toFixed(2)}
                    </td>
                    <td className="p-3 text-right">
                      <Link href={`/shifts/${shift.id}`} className="text-blue-400 hover:underline">
                        Report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
