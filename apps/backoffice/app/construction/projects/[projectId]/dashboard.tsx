"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { CON_BRAND, errorText } from "../../../../lib/construction";
import { ErrorBox, Panel } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

interface ProjectDashboard {
  programme: { progress: number; elapsed: number | null; schedule: "BEHIND" | "ON_TRACK" | "UNKNOWN"; overdue: Milestone[]; next: Milestone[] };
  today: { present: number; half: number; absent: number; diary: string | null; photos: number };
  waiting: { requisitions: number; lpos: number; variations: number; payroll: number };
  safety: { incidents30: number; doshsOverdue: number; daysSinceLti: number | null; openPermits: number };
  materials: { overBudget: string[]; unaccounted: { name: string; unit: string; qty: number }[] };
  money: null | { budget: number; cost: number; budgetUsed: number | null; certified: number; margin: number; materials: number; labour: number; plant: number; subcontracts: number; lastValuation: { number: number; status: string; kind: string; netDue: number; certifiedAt: string | null } | null };
}
interface Milestone { id: string; name: string; endDate: string; percentComplete: number }

const k = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const RED = "#dc2626";
const GREEN = "#16a34a";

/** The Project Manager's view of one project: programme, today on site, what waits for approval, safety, materials, money. */
export function DashboardTab({ project }: TabProps) {
  const [d, setD] = useState<ProjectDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<ProjectDashboard>(`/construction/projects/${project.id}/dashboard`).then(setD).catch((e) => setError(errorText(e, "Could not load the dashboard.")));
  }, [project.id]);

  if (error) return <ErrorBox message={error} />;
  if (!d) return <p className="text-sm text-secondary-500">Loading...</p>;
  const waiting = [
    [d.waiting.requisitions, "requisitions to approve"],
    [d.waiting.lpos, "LPOs to approve"],
    [d.waiting.variations, "variations to decide"],
    [d.waiting.payroll, "pay runs to approve"],
  ].filter(([n]) => (n as number) > 0) as [number, string][];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Programme">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold" style={{ color: "var(--con-ink)" }}>{d.programme.progress}%</span>
          <span className="text-sm text-secondary-600">done{d.programme.elapsed !== null ? ` · ${d.programme.elapsed}% of the time used` : ""}</span>
        </div>
        <Bar value={d.programme.progress} marker={d.programme.elapsed} />
        {d.programme.schedule === "BEHIND" && <p className="mt-2 text-sm font-semibold" style={{ color: RED }}>Behind programme</p>}
        {d.programme.overdue.length > 0 && (
          <p className="mt-2 text-sm" style={{ color: RED }}>Overdue: {d.programme.overdue.map((m) => `${m.name} (${m.percentComplete}%)`).join(", ")}</p>
        )}
        {d.programme.next.length > 0 && <p className="mt-1 text-sm text-secondary-600">Next: {d.programme.next.map((m) => `${m.name} by ${m.endDate}`).join(", ")}</p>}
      </Panel>

      <Panel title="On site today">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat n={d.today.present} label="Present" colour={GREEN} />
          <Stat n={d.today.half} label="Half day" colour={CON_BRAND.orange} />
          <Stat n={d.today.absent} label="Absent" colour={RED} />
        </div>
        <p className="mt-2 text-sm text-secondary-600">Diary: {d.today.diary ? d.today.diary.toLowerCase() : "not started"} · {d.today.photos} photo{d.today.photos === 1 ? "" : "s"} today</p>
      </Panel>

      <Panel title="Waiting for you">
        {waiting.length === 0 ? <p className="text-sm text-secondary-500">Nothing waiting.</p> : (
          <ul className="space-y-1 text-sm">{waiting.map(([n, label]) => <li key={label}><strong>{n}</strong> {label}</li>)}</ul>
        )}
      </Panel>

      <Panel title="Safety">
        <ul className="space-y-1 text-sm">
          <li>{d.safety.daysSinceLti === null ? "No lost-time incident recorded" : <><strong>{d.safety.daysSinceLti}</strong> days since the last lost-time incident</>}</li>
          <li><strong>{d.safety.incidents30}</strong> incidents in the last 30 days</li>
          <li><strong>{d.safety.openPermits}</strong> permits to work open</li>
          {d.safety.doshsOverdue > 0 && <li style={{ color: RED }}><strong>{d.safety.doshsOverdue}</strong> DOSHS report{d.safety.doshsOverdue === 1 ? "" : "s"} overdue</li>}
        </ul>
      </Panel>

      {(d.materials.overBudget.length > 0 || d.materials.unaccounted.length > 0) && (
        <Panel title="Materials to look at">
          {d.materials.overBudget.length > 0 && <p className="text-sm">Over the BQ allowance: {d.materials.overBudget.join(", ")}</p>}
          {d.materials.unaccounted.length > 0 && <p className="mt-1 text-sm" style={{ color: RED }}>Unaccounted: {d.materials.unaccounted.map((m) => `${m.qty} ${m.unit} ${m.name}`).join(", ")}</p>}
        </Panel>
      )}

      {d.money && (
        <Panel title="Money">
          <p className="text-sm">Cost to date <strong>{k(d.money.cost)}</strong> of {k(d.money.budget)}{d.money.budgetUsed !== null ? ` (${d.money.budgetUsed}%)` : ""}</p>
          <Bar value={d.money.budgetUsed ?? 0} />
          <p className="mt-2 text-sm">Certified <strong>{k(d.money.certified)}</strong> · margin <strong style={{ color: d.money.margin < 0 ? RED : GREEN }}>{k(d.money.margin)}</strong></p>
          <p className="mt-1 text-xs text-secondary-500">Materials {k(d.money.materials)} · labour {k(d.money.labour)} · plant {k(d.money.plant)} · subcontracts {k(d.money.subcontracts)}</p>
          {d.money.lastValuation && <p className="mt-1 text-xs text-secondary-500">Latest valuation no. {d.money.lastValuation.number}: {d.money.lastValuation.status.toLowerCase()}{d.money.lastValuation.certifiedAt ? ` ${d.money.lastValuation.certifiedAt}` : ""}</p>}
        </Panel>
      )}
    </div>
  );
}

function Stat({ n, label, colour }: { n: number; label: string; colour: string }) {
  return (
    <div className="rounded-lg bg-background p-2">
      <p className="text-2xl font-bold" style={{ color: colour }}>{n}</p>
      <p className="text-xs text-secondary-500">{label}</p>
    </div>
  );
}

function Bar({ value, marker }: { value: number; marker?: number | null }) {
  return (
    <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-background">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: value > 100 ? RED : CON_BRAND.gold }} />
      {marker !== null && marker !== undefined && <div className="absolute top-0 h-full w-0.5" style={{ left: `${marker}%`, background: CON_BRAND.navy }} title="Time used" />}
    </div>
  );
}
