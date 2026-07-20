"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getActiveSession, getDeviceConfig, type CashierSession, type DeviceConfig } from "../../lib/db";
import { apiGet, apiPatch, ApiError, OfflineError } from "../../lib/api";

interface KitchenStation {
  id: string;
  branchId: string;
  name: string;
}

interface TicketLine {
  id: string;
  variantId: string;
  quantity: number;
  notes: string | null;
  variant: { product: { name: string } };
}

type TicketStatus = "QUEUED" | "IN_PROGRESS" | "READY" | "SERVED";

interface KitchenTicket {
  id: string;
  saleId: string;
  stationId: string;
  courseNumber: number;
  status: TicketStatus;
  createdAt: string;
  lines: TicketLine[];
  station: { name: string };
}

const NEXT_LABEL: Record<TicketStatus, string> = {
  QUEUED: "Start",
  IN_PROGRESS: "Ready",
  READY: "Served",
  SERVED: "",
};

const STATUS_COLOR: Record<TicketStatus, string> = {
  QUEUED: "border-amber-600",
  IN_PROGRESS: "border-blue-600",
  READY: "border-green-600",
  SERVED: "border-slate-700",
};

/**
 * Kitchen display screen - a plain poll-based refresh (10s) rather than
 * anything push-based, matching this codebase's "no realtime
 * infrastructure yet" scope everywhere else. Online-only, same reasoning
 * as the table order builder: a ticket that isn't actually reaching the
 * kitchen live isn't doing its job queued for later.
 */
export default function KdsPage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [stationId, setStationId] = useState<string>("");
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) return router.replace("/setup");
      const activeSession = await getActiveSession();
      if (!activeSession) return router.replace("/login");
      if (config.industryType !== "RESTAURANT") return router.replace("/pos");
      setDevice(config);
      setSession(activeSession);
      try {
        const stationList = await apiGet<KitchenStation[]>(`/restaurant/stations?branchId=${config.branchId}`, activeSession.accessToken);
        setStations(stationList);
        setStationId(stationList[0]?.id ?? "");
      } catch (err) {
        setError(err instanceof OfflineError ? "Offline - the kitchen display needs a connection." : "Could not load stations.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refreshTickets(currentSession: CashierSession, currentStationId: string) {
    try {
      const result = await apiGet<KitchenTicket[]>(
        `/restaurant/kitchen-tickets${currentStationId ? `?stationId=${currentStationId}` : ""}`,
        currentSession.accessToken,
      );
      setTickets(result.filter((t) => t.status !== "SERVED"));
      setError(null);
    } catch (err) {
      setError(err instanceof OfflineError ? "Offline - the kitchen display needs a connection." : "Could not load tickets.");
    }
  }

  useEffect(() => {
    if (!session || !stationId) return;
    void refreshTickets(session, stationId);
    const interval = setInterval(() => void refreshTickets(session, stationId), 10_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, stationId]);

  const sorted = useMemo(
    () => [...tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tickets],
  );

  async function advance(ticket: KitchenTicket) {
    if (!session) return;
    setBusyId(ticket.id);
    try {
      await apiPatch(`/restaurant/kitchen-tickets/${ticket.id}/advance`, {}, session.accessToken);
      await refreshTickets(session, stationId);
    } catch (err) {
      setError(
        err instanceof OfflineError ? "Offline - could not advance the ticket." : err instanceof ApiError ? err.message : "Could not advance ticket - try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!device || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 p-3">
        <button onClick={() => router.push("/pos")} className="text-blue-400">
          &larr; POS
        </button>
        <select
          value={stationId}
          onChange={(e) => setStationId(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-800 p-2"
        >
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="w-16" />
      </header>

      {error && <div className="bg-red-900 p-2 text-center text-sm">{error}</div>}

      <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((ticket) => (
          <div key={ticket.id} className={`flex flex-col rounded-lg border-2 bg-slate-800 p-3 ${STATUS_COLOR[ticket.status]}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-400">Course {ticket.courseNumber}</span>
              <span className="text-xs uppercase tracking-wide text-slate-400">{ticket.status.replace("_", " ")}</span>
            </div>
            <div className="mt-2 flex-1 space-y-1">
              {ticket.lines.map((line) => (
                <div key={line.id} className="text-sm">
                  <span className="font-medium">{line.quantity}x {line.variant.product.name}</span>
                  {line.notes && <p className="text-xs text-amber-400">{line.notes}</p>}
                </div>
              ))}
            </div>
            {ticket.status !== "SERVED" && (
              <button
                onClick={() => void advance(ticket)}
                disabled={busyId === ticket.id}
                className="mt-3 w-full rounded-md bg-blue-600 p-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
              >
                {busyId === ticket.id ? "..." : NEXT_LABEL[ticket.status]}
              </button>
            )}
          </div>
        ))}
        {sorted.length === 0 && !error && <p className="col-span-full text-center text-slate-400">No active tickets for this station.</p>}
      </div>
    </div>
  );
}
