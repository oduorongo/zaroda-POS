"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";

interface ShiftReport {
  shiftId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  saleCount: number;
  voidedCount: number;
  totalSales: number;
  paymentsByMethod: Record<string, number>;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
}

/** X-report if the shift is still open (a live snapshot, nothing is closed by viewing it), Z-report once closed - same GET endpoint either way. */
export default function ShiftReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void (async () => {
      try {
        setReport(await apiGet<ShiftReport>(`/shifts/${params.id}/report`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the shift report.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, params.id]);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-2xl p-6">
        <button onClick={() => router.push("/shifts")} className="mb-4 text-blue-400 hover:underline">
          &larr; Shifts
        </button>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {!report && !error && <p className="text-slate-400">Loading...</p>}
        {report && (
          <>
            <h1 className="text-xl font-bold">
              {report.closedAt ? "Z-report" : "X-report"} - Shift {report.shiftId}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Opened {new Date(report.openedAt).toLocaleString()}
              {report.closedAt ? ` · Closed ${new Date(report.closedAt).toLocaleString()}` : " · Still open"}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <Stat label="Opening float" value={`KES ${report.openingFloat.toFixed(2)}`} />
              <Stat label="Sales" value={String(report.saleCount)} />
              <Stat label="Voided sales" value={String(report.voidedCount)} />
              <Stat label="Total sales" value={`KES ${report.totalSales.toFixed(2)}`} />
              <Stat label="Expected cash" value={`KES ${report.expectedCash.toFixed(2)}`} />
              <Stat
                label="Counted cash"
                value={report.countedCash === null ? "Not yet counted" : `KES ${report.countedCash.toFixed(2)}`}
              />
            </div>

            {report.variance !== null && (
              <div className={`mt-4 rounded-md p-3 text-sm ${report.variance === 0 ? "bg-green-950 text-green-300" : "bg-amber-950 text-amber-300"}`}>
                Variance: KES {report.variance.toFixed(2)} {report.variance === 0 ? "(exact match)" : report.variance > 0 ? "(over)" : "(short)"}
              </div>
            )}

            <section className="mt-6 rounded-lg border border-slate-800 p-4">
              <h2 className="mb-2 font-semibold">Payments by method</h2>
              {Object.entries(report.paymentsByMethod).length === 0 && <p className="text-sm text-slate-400">No completed sales.</p>}
              {Object.entries(report.paymentsByMethod).map(([method, amount]) => (
                <p key={method} className="text-sm">
                  {method}: KES {amount.toFixed(2)}
                </p>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-lg">{value}</p>
    </div>
  );
}
