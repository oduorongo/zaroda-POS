"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getActiveSession, getDeviceConfig, type CashierSession, type DeviceConfig } from "../../lib/db";
import { apiGet, apiPatch, ApiError, OfflineError } from "../../lib/api";
import { Button } from "@zaroda/ui";

interface Shift {
  id: string;
  openedAt: string;
  closedAt: string | null;
}

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

/**
 * End-of-day / shift close-out (Z-report), run from the terminal itself -
 * shifts are opened from the back office today (no terminal-side "open
 * shift" flow exists yet, see apps/backoffice/app/shifts), but a cashier
 * closing out their own till at the register (rather than having to hand
 * the device to a manager on a laptop) is the more natural place for this.
 * Reuses the same GET .../report and PATCH .../close endpoints the
 * back office's shifts/[id] screen already calls.
 */
export default function ShiftClosePage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<Shift | null>(null);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [countedCash, setCountedCash] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closedReport, setClosedReport] = useState<ShiftReport | null>(null);

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) {
        router.replace("/setup");
        return;
      }
      const activeSession = await getActiveSession();
      if (!activeSession) {
        router.replace("/login");
        return;
      }
      setDevice(config);
      setSession(activeSession);
      try {
        const shifts = await apiGet<Shift[]>(
          `/shifts?terminalId=${config.terminalId}&open=true`,
          activeSession.accessToken,
        );
        const current = shifts[0] ?? null;
        setOpenShift(current);
        if (current) {
          const currentReport = await apiGet<ShiftReport>(
            `/shifts/${current.id}/report`,
            activeSession.accessToken,
          );
          setReport(currentReport);
        }
      } catch (err) {
        setLoadError(
          err instanceof OfflineError
            ? "Offline - shift close-out needs a connection."
            : err instanceof ApiError
              ? err.message
              : "Could not load shift status.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function closeShift() {
    if (!session || !openShift) return;
    const amount = Number(countedCash);
    if (!Number.isFinite(amount) || amount < 0) return;
    setClosing(true);
    setCloseError(null);
    try {
      const result = await apiPatch<{ report: ShiftReport }>(
        `/shifts/${openShift.id}/close`,
        { countedCash: amount },
        session.accessToken,
      );
      setClosedReport(result.report);
    } catch (err) {
      setCloseError(
        err instanceof OfflineError
          ? "Offline - closing a shift needs a connection."
          : err instanceof ApiError
            ? err.message
            : "Could not close shift.",
      );
    } finally {
      setClosing(false);
    }
  }

  if (!device || !session || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary-900 text-secondary-100">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-700 border-t-primary-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary-900 p-4 text-secondary-100">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Funga Zamu · End shift</h1>
          <button onClick={() => router.push("/pos")} className="min-h-touch px-2 text-sm text-primary-400">
            Back to till
          </button>
        </div>

        {loadError && (
          <div className="rounded-lg bg-error-700/20 p-4 text-sm text-error-500">{loadError}</div>
        )}

        {!loadError && !openShift && (
          <div className="rounded-lg bg-secondary-800 p-6 text-center">
            <p className="font-medium">No open shift on this terminal</p>
            <p className="mt-1 text-sm text-secondary-400">
              Shifts are opened from the back office. Ask a supervisor to open one before selling.
            </p>
          </div>
        )}

        {!loadError && openShift && report && !closedReport && (
          <div className="space-y-4">
            <div className="rounded-lg bg-secondary-800 p-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">Shift opened</p>
              <p className="font-medium">{new Date(report.openedAt).toLocaleString()}</p>
            </div>

            <div className="rounded-lg bg-secondary-800 p-4">
              <h2 className="mb-2 font-semibold">X-Report (live)</h2>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-secondary-400">Opening float</dt><dd>KES {report.openingFloat.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-secondary-400">Sales completed</dt><dd>{report.saleCount}</dd></div>
                <div className="flex justify-between"><dt className="text-secondary-400">Voided</dt><dd>{report.voidedCount}</dd></div>
                <div className="flex justify-between"><dt className="text-secondary-400">Total sales</dt><dd>KES {report.totalSales.toFixed(2)}</dd></div>
                {Object.entries(report.paymentsByMethod).map(([method, amount]) => (
                  <div key={method} className="flex justify-between pl-3 text-secondary-400">
                    <dt>{method}</dt><dd>KES {amount.toFixed(2)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-secondary-700 pt-1.5 font-semibold">
                  <dt>Expected cash in drawer</dt><dd>KES {report.expectedCash.toFixed(2)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg bg-secondary-800 p-4">
              <h2 className="mb-2 font-semibold">Cash reconciliation</h2>
              <label className="mb-1.5 block text-sm text-secondary-400">Cash counted in drawer</label>
              <input
                type="number"
                min={0}
                autoFocus
                className="w-full rounded-md border border-secondary-600 bg-secondary-900 p-3 text-lg"
                placeholder="0.00"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
              />
              {Number.isFinite(Number(countedCash)) && countedCash !== "" && (
                <p className={`mt-2 text-sm ${Math.abs(Number(countedCash) - report.expectedCash) < 0.01 ? "text-success-500" : "text-warning-500"}`}>
                  Variance: KES {(Number(countedCash) - report.expectedCash).toFixed(2)}
                </p>
              )}
              {closeError && <p className="mt-2 text-sm text-error-500">{closeError}</p>}
              <Button
                onClick={closeShift}
                disabled={closing || !Number.isFinite(Number(countedCash)) || Number(countedCash) < 0}
                variant="danger"
                size="touch"
                className="mt-4 w-full"
              >
                {closing ? "Closing..." : "Close shift"}
              </Button>
            </div>
          </div>
        )}

        {closedReport && (
          <div className="rounded-lg bg-secondary-800 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-600 text-2xl">✓</div>
            <p className="mt-3 font-semibold">Shift closed - Z-report recorded</p>
            <dl className="mt-4 space-y-1.5 text-left text-sm">
              <div className="flex justify-between"><dt className="text-secondary-400">Expected</dt><dd>KES {closedReport.expectedCash.toFixed(2)}</dd></div>
              <div className="flex justify-between"><dt className="text-secondary-400">Counted</dt><dd>KES {(closedReport.countedCash ?? 0).toFixed(2)}</dd></div>
              <div className="flex justify-between font-semibold">
                <dt>Variance</dt>
                <dd className={Math.abs(closedReport.variance ?? 0) < 0.01 ? "text-success-500" : "text-warning-500"}>
                  KES {(closedReport.variance ?? 0).toFixed(2)}
                </dd>
              </div>
            </dl>
            <Button onClick={() => router.push("/login")} variant="primary" size="touch" className="mt-6 w-full">
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
