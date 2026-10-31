"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "../../../../../lib/api";
import { CON_BRAND, errorText, isDirector } from "../../../../../lib/construction";
import { addDays, cacheSheet, cachedSheet, flushMarks, queueMarks, queuedMarks, todayEat, type MusterStatus } from "../../../../../lib/con-site";
import { ConShell, useConMe } from "../../../../../components/construction/con-shell";
import { ErrorBox, ExpiryBadge, type ExpiryState } from "../../../../../components/construction/ui";

interface Row { workerId: string; name: string; trade: string; isSupervisor: boolean; ncaState: ExpiryState | null; status: MusterStatus | null; hours: number | null }
interface Sheet { date: string; rows: Row[]; totals: { present: number; half: number; absent: number; days: number } }

const BUTTONS: { status: MusterStatus; label: string; colour: string }[] = [
  { status: "PRESENT", label: "Present", colour: "#16a34a" },
  { status: "HALF", label: "½ day", colour: CON_BRAND.orange },
  { status: "ABSENT", label: "Absent", colour: "#dc2626" },
];

export default function MusterPage() {
  return (
    <ConShell title="Muster roll">
      <Muster />
    </ConShell>
  );
}

function Muster() {
  const { projectId } = useParams<{ projectId: string }>();
  const me = useConMe();
  const canMark = isDirector(me) || !!me?.projectRoles.some((r) => r.projectId === projectId && ["CON_PROJECT_MGR", "CON_SITE_SUPERVISOR", "CON_TIMEKEEPER"].includes(r.role));
  const [date, setDate] = useState(todayEat());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const applyQueued = useCallback((s: Sheet) => {
    const q = queuedMarks().filter((m) => m.projectId === projectId && m.date === s.date);
    return q.length ? { ...s, rows: s.rows.map((r) => ({ ...r, status: q.find((m) => m.workerId === r.workerId)?.status ?? r.status })) } : s;
  }, [projectId]);

  const load = useCallback(async () => {
    try {
      const s = await apiGet<Sheet>(`/construction/projects/${projectId}/muster?date=${date}`);
      cacheSheet(projectId, date, s);
      setSheet(applyQueued(s));
      setOffline(false);
    } catch (e) {
      const cached = cachedSheet<Sheet>(projectId, date);
      if (cached) {
        setSheet(applyQueued(cached));
        setOffline(true);
      } else setError(errorText(e, "Could not load the muster roll - check your signal."));
    }
  }, [projectId, date, applyQueued]);

  const flush = useCallback(async () => {
    const r = await flushMarks();
    setWaiting(r.waiting);
    if (r.refused.length) setError(r.refused.join(" "));
    if (r.waiting === 0 && navigator.onLine) setOffline(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setWaiting(queuedMarks().length);
    void flush();
    const online = () => void flush().then(load);
    window.addEventListener("online", online);
    const every = setInterval(() => queuedMarks().length && void flush(), 30_000);
    return () => {
      window.removeEventListener("online", online);
      clearInterval(every);
    };
  }, [flush, load]);

  function mark(workerIds: string[], status: MusterStatus) {
    if (!sheet || !canMark) return;
    setSheet({ ...sheet, rows: sheet.rows.map((r) => (workerIds.includes(r.workerId) ? { ...r, status } : r)) });
    queueMarks(workerIds.map((workerId) => ({ projectId, date: sheet.date, workerId, status, clientRef: `${workerId}:${sheet.date}:${Date.now()}` })));
    setWaiting(queuedMarks().length);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }

  const counts = sheet ? { present: sheet.rows.filter((r) => r.status === "PRESENT").length, half: sheet.rows.filter((r) => r.status === "HALF").length, absent: sheet.rows.filter((r) => r.status === "ABSENT").length, none: sheet.rows.filter((r) => !r.status).length } : null;
  const isToday = date === todayEat();

  return (
    <div className="space-y-3">
      <Link href="/construction/site" className="text-sm" style={{ color: CON_BRAND.orange }}>← Site</Link>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="rounded-xl border border-border px-4 py-3 text-lg" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
        <div className="text-center">
          <p className="text-lg font-bold">{isToday ? "Today" : new Date(`${date}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "long" })}</p>
          <p className="text-xs text-secondary-500">{date}</p>
        </div>
        <button type="button" className="rounded-xl border border-border px-4 py-3 text-lg disabled:opacity-30" disabled={isToday} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
      </div>

      {(offline || waiting > 0) && (
        <p className="rounded-xl px-3 py-2 text-sm font-medium text-white" style={{ background: offline ? "#b45309" : "#2563eb" }}>
          {offline ? "No signal - showing the last saved list. " : ""}{waiting > 0 ? `${waiting} mark${waiting === 1 ? "" : "s"} waiting to send - they go out by themselves when the signal is back.` : ""}
        </p>
      )}
      <ErrorBox message={error} />

      {counts && (
        <div className="grid grid-cols-4 gap-2 text-center text-sm">
          <Stat n={counts.present} label="Present" colour="#16a34a" />
          <Stat n={counts.half} label="Half" colour={CON_BRAND.orange} />
          <Stat n={counts.absent} label="Absent" colour="#dc2626" />
          <Stat n={counts.none} label="Not marked" colour="#6b7280" />
        </div>
      )}

      {canMark && sheet && sheet.rows.length > 0 && (
        <button type="button" className="w-full rounded-xl py-4 text-lg font-bold text-white active:scale-[0.99]" style={{ background: "#16a34a" }} onClick={() => mark(sheet.rows.filter((r) => !r.status).map((r) => r.workerId), "PRESENT")}>
          Mark everyone not marked as present
        </button>
      )}

      {sheet?.rows.length === 0 && <p className="text-sm text-secondary-500">No workers on this project yet. Add them under Workers.</p>}
      <ul className="space-y-2">
        {sheet?.rows.map((r) => (
          <li key={r.workerId} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{r.name}{r.isSupervisor && <span className="ml-1 text-xs" style={{ color: CON_BRAND.orange }}>Foreman</span>}</p>
                <p className="text-xs text-secondary-500">{r.trade}</p>
              </div>
              {r.ncaState === "EXPIRED" && <ExpiryBadge state="EXPIRED" />}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {BUTTONS.map((b) => {
                const on = r.status === b.status;
                return (
                  <button
                    key={b.status}
                    type="button"
                    disabled={!canMark}
                    onClick={() => mark([r.workerId], b.status)}
                    className="min-h-[52px] rounded-lg border-2 text-base font-semibold active:scale-[0.97] disabled:opacity-60"
                    style={on ? { background: b.colour, borderColor: b.colour, color: "white" } : { borderColor: b.colour, color: b.colour }}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
            {r.ncaState === "EXPIRED" && <p className="mt-1 text-xs text-red-700">NCA card expired - renew it before skilled work.</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ n, label, colour }: { n: number; label: string; colour: string }) {
  return (
    <div className="rounded-xl bg-surface p-2 shadow-sm">
      <p className="text-xl font-bold" style={{ color: colour }}>{n}</p>
      <p className="text-[11px] text-secondary-500">{label}</p>
    </div>
  );
}
