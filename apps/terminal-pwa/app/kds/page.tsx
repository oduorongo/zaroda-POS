"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ringAlert, unlockAudio } from "@zaroda/ui";
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
  /** Set when the item was voided from the bill after it was sent: the cook should stop making it. */
  voidedAt: string | null;
  variant: { product: { name: string } };
}

type TicketStatus = "HELD" | "QUEUED" | "IN_PROGRESS" | "READY" | "SERVED";

interface KitchenTicket {
  id: string;
  saleId: string | null;
  stationId: string;
  courseNumber: number;
  status: TicketStatus;
  createdAt: string;
  firedAt: string | null;
  lines: TicketLine[];
  station: { name: string };
  tab: { table: { label: string } } | null;
  sale: { restaurantTable: { table: { label: string } } | null } | null;
}

const NEXT_LABEL: Record<TicketStatus, string> = {
  HELD: "",
  QUEUED: "Start",
  IN_PROGRESS: "Ready",
  READY: "Served",
  SERVED: "",
};

const STATUS_COLOR: Record<TicketStatus, string> = {
  HELD: "border-slate-700",
  QUEUED: "border-amber-600",
  IN_PROGRESS: "border-primary-600",
  READY: "border-green-600",
  SERVED: "border-slate-700",
};

const POLL_MS = 6_000;
const NEW_HIGHLIGHT_MS = 10_000;

const tableOf = (t: KitchenTicket) => t.tab?.table.label ?? t.sale?.restaurantTable?.table.label ?? null;

/** Minutes since the ticket reached the kitchen (when it was fired, for a held course). */
const waitMinutes = (t: KitchenTicket, now: number) => Math.max(0, Math.floor((now - new Date(t.firedAt ?? t.createdAt).getTime()) / 60_000));

/**
 * Kitchen display screen: refreshes every few seconds, rings and highlights tickets that have just arrived, shows how long each
 * has been waiting, and shows an item voided from the bill struck through. Courses that have not been fired yet are not shown.
 * Online-only: a ticket that isn't reaching the kitchen live isn't doing its job queued for later.
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
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Record<string, number>>({});
  const [soundOn, setSoundOn] = useState(false);

  // Tickets seen so far on this screen; the first load only fills it (no ringing for what was already there).
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) return router.replace("/setup");
      const activeSession = await getActiveSession();
      if (!activeSession) return router.replace("/login");
      if (config.industryType !== "RESTAURANT" && config.industryType !== "HOTEL") return router.replace("/pos");
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
  }, [router]);

  // Browsers only allow sound after a touch; the first tap anywhere turns it on.
  useEffect(() => {
    const unlock = () => setSoundOn(unlockAudio());
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // keeps the "waiting for N min" figures moving between refreshes
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function refreshTickets(currentSession: CashierSession, currentStationId: string) {
    try {
      const result = await apiGet<KitchenTicket[]>(`/restaurant/kitchen-tickets${currentStationId ? `?stationId=${currentStationId}` : ""}`, currentSession.accessToken);
      // a course that has not been fired is not on the kitchen screen
      const active = result.filter((t) => t.status !== "SERVED" && t.status !== "HELD");
      setTickets(active);
      setError(null);

      const known = seen.current;
      seen.current = new Set(active.map((t) => t.id));
      if (known) {
        const arrived = active.filter((t) => !known.has(t.id));
        if (arrived.length > 0) {
          ringAlert();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          const stamp = Date.now();
          setFresh((f) => ({ ...f, ...Object.fromEntries(arrived.map((t) => [t.id, stamp])) }));
        }
      }
    } catch (err) {
      setError(err instanceof OfflineError ? "Offline - the kitchen display needs a connection." : "Could not load tickets.");
    }
  }

  useEffect(() => {
    if (!session || !stationId) return;
    seen.current = null; // another station: start by learning what is already there
    void refreshTickets(session, stationId);
    const interval = setInterval(() => void refreshTickets(session, stationId), POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, stationId]);

  // the highlight fades after a few seconds
  useEffect(() => {
    if (Object.keys(fresh).length === 0) return;
    const timer = setTimeout(() => setFresh((f) => Object.fromEntries(Object.entries(f).filter(([, at]) => Date.now() - at < NEW_HIGHLIGHT_MS))), NEW_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [fresh]);

  const sorted = useMemo(() => [...tickets].sort((a, b) => (a.firedAt ?? a.createdAt).localeCompare(b.firedAt ?? b.createdAt)), [tickets]);

  async function advance(ticket: KitchenTicket) {
    if (!session) return;
    setBusyId(ticket.id);
    try {
      await apiPatch(`/restaurant/kitchen-tickets/${ticket.id}/advance`, {}, session.accessToken);
      await refreshTickets(session, stationId);
    } catch (err) {
      setError(err instanceof OfflineError ? "Offline - could not advance the ticket." : err instanceof ApiError ? err.message : "Could not advance ticket - try again.");
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
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-primary-400">
            &larr; Back
          </button>
          <button onClick={() => router.push("/pos")} className="text-primary-400">
            Home
          </button>
        </div>
        <select value={stationId} onChange={(e) => setStationId(e.target.value)} className="rounded-md border border-slate-700 bg-slate-800 p-2">
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="w-24 text-right text-xs text-slate-400">{soundOn ? "Sound on" : "Tap for sound"}</span>
      </header>

      {error && <div className="bg-red-900 p-2 text-center text-sm">{error}</div>}

      <div className="grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((ticket) => {
          const minutes = waitMinutes(ticket, now);
          const isNew = fresh[ticket.id] !== undefined;
          return (
            <div key={ticket.id} className={`flex flex-col rounded-lg border-2 bg-slate-800 p-3 ${STATUS_COLOR[ticket.status]} ${isNew ? "animate-pulse ring-4 ring-amber-400" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-slate-400">Course {ticket.courseNumber}</span>
                <span className="text-xs uppercase tracking-wide text-slate-400">{ticket.status.replace("_", " ")}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-lg font-bold">{tableOf(ticket) ?? "Order"}</span>
                <span className={`font-mono text-sm ${minutes >= 20 ? "font-bold text-red-400" : minutes >= 10 ? "text-amber-400" : "text-slate-400"}`}>{minutes} min</span>
              </div>
              <div className="mt-2 flex-1 space-y-1">
                {ticket.lines.map((line) => (
                  <div key={line.id} className={`text-sm ${line.voidedAt ? "text-slate-500" : ""}`}>
                    <span className={`font-medium ${line.voidedAt ? "line-through" : ""}`}>
                      {line.quantity}x {line.variant.product.name}
                    </span>
                    {line.voidedAt && <span className="ml-2 rounded bg-red-900 px-1.5 py-0.5 text-xs font-semibold text-red-200">CANCELLED</span>}
                    {line.notes && !line.voidedAt && <p className="text-xs text-amber-400">{line.notes}</p>}
                  </div>
                ))}
              </div>
              {ticket.status !== "SERVED" && (
                <button
                  onClick={() => void advance(ticket)}
                  disabled={busyId === ticket.id}
                  className="mt-3 w-full rounded-md bg-primary-600 p-2 text-sm font-semibold hover:bg-primary-500 disabled:opacity-40"
                >
                  {busyId === ticket.id ? "..." : NEXT_LABEL[ticket.status]}
                </button>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && !error && <p className="col-span-full text-center text-slate-400">No active tickets for this station.</p>}
      </div>
    </div>
  );
}
