"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { CON_BRAND, errorText } from "../../lib/construction";
import { ErrorBox, Panel } from "../../components/construction/ui";
import { STATUS_COLOUR, STATUS_LABEL, type ProjectStatus } from "./projects/shared";

interface DirectorDashboard {
  totals: { projects: number; budget: number; certified: number; cost: number; margin: number; invoiced: number; received: number; outstanding: number; retentionHeld: number; workersToday: number; behind: number; doshsOverdue: number };
  approvals: { lpos: number; lpoValue: number; requisitions: number; valuations: number; variations: number; payroll: number; payrollValue: number; diaries: number };
  compliance: { health: "GOOD" | "ATTENTION" | "CRITICAL"; expired: number; expiring: number; missing: string[] };
  projects: { id: string; code: string; name: string; status: ProjectStatus; progress: number; elapsed: number | null; schedule: string; budget: number; certified: number; certifiedPct: number | null; cost: number; margin: number; budgetUsed: number | null; outstanding: number; workersToday: number; doshsOverdue: number; waiting: Record<string, number> }[];
}

const m = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("en-KE", { maximumFractionDigits: 1 })}M` : Math.round(n).toLocaleString("en-KE"));
const RED = "#dc2626";

/** Director / Contracts Manager: every open project at a glance, money, what waits for approval, and red flags. */
export function DirectorOverview() {
  const [d, setD] = useState<DirectorDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<DirectorDashboard>("/construction/dashboard/director").then(setD).catch((e) => setError(errorText(e, "Could not load the overview.")));
  }, []);
  if (error) return <ErrorBox message={error} />;
  if (!d) return null;
  const t = d.totals;
  const a = d.approvals;
  const waiting = [
    [a.lpos, `LPOs (KES ${m(a.lpoValue)})`],
    [a.requisitions, "requisitions"],
    [a.valuations, "draft valuations"],
    [a.variations, "variations"],
    [a.payroll, `pay runs (KES ${m(a.payrollValue)})`],
    [a.diaries, "site diaries"],
  ].filter(([n]) => (n as number) > 0) as [number, string][];

  return (
    <Panel title="All open projects" action={<Link href="/construction/reports" className="text-sm font-medium" style={{ color: CON_BRAND.orange }}>Reports</Link>}>
      <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
        <Tile label="Contract value" value={`KES ${m(t.budget)}`} />
        <Tile label="Certified" value={`KES ${m(t.certified)}`} />
        <Tile label="Cost to date" value={`KES ${m(t.cost)}`} />
        <Tile label="Margin" value={`KES ${m(t.margin)}`} colour={t.margin < 0 ? RED : "#16a34a"} />
        <Tile label="Owed by clients" value={`KES ${m(t.outstanding)}`} />
        <Tile label="Retention held" value={`KES ${m(t.retentionHeld)}`} />
        <Tile label="On site today" value={String(t.workersToday)} />
        <Tile label="Behind programme" value={String(t.behind)} colour={t.behind ? RED : undefined} />
      </div>
      {(t.doshsOverdue > 0 || d.compliance.expired > 0) && (
        <p className="mt-3 text-sm font-semibold" style={{ color: RED }}>
          {[t.doshsOverdue ? `${t.doshsOverdue} DOSHS report${t.doshsOverdue === 1 ? "" : "s"} overdue` : "", d.compliance.expired ? `${d.compliance.expired} compliance document${d.compliance.expired === 1 ? "" : "s"} expired` : ""].filter(Boolean).join(" · ")}
        </p>
      )}
      <p className="mt-3 text-sm">{waiting.length ? <>Waiting for approval: {waiting.map(([n, l]) => `${n} ${l}`).join(", ")}</> : "Nothing waiting for approval."}</p>
      {d.projects.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-border text-left text-secondary-500">
                <th className="py-1 pr-2">Project</th>
                <th className="py-1 pr-2 text-right">Done / time</th>
                <th className="py-1 pr-2 text-right">Certified</th>
                <th className="py-1 pr-2 text-right">Cost / budget</th>
                <th className="py-1 pr-2 text-right">Margin</th>
                <th className="py-1 text-right">Today</th>
              </tr>
            </thead>
            <tbody>
              {d.projects.map((p) => (
                <tr key={p.id} className="border-b border-border">
                  <td className="py-1.5 pr-2">
                    <Link href={`/construction/projects/${p.id}`} className="no-underline">{p.code}</Link>{" "}
                    <span className="text-xs" style={{ color: STATUS_COLOUR[p.status] }}>{STATUS_LABEL[p.status]}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right" style={p.schedule === "BEHIND" ? { color: RED, fontWeight: 600 } : undefined}>{p.progress}%{p.elapsed !== null ? ` / ${p.elapsed}%` : ""}</td>
                  <td className="py-1.5 pr-2 text-right">{p.certifiedPct !== null ? `${p.certifiedPct}%` : "-"}</td>
                  <td className="py-1.5 pr-2 text-right" style={(p.budgetUsed ?? 0) > 100 ? { color: RED } : undefined}>{p.budgetUsed !== null ? `${p.budgetUsed}%` : "-"}</td>
                  <td className="py-1.5 pr-2 text-right" style={{ color: p.margin < 0 ? RED : undefined }}>{m(p.margin)}</td>
                  <td className="py-1.5 text-right">{p.workersToday}{p.doshsOverdue ? <span style={{ color: RED }}> · DOSHS!</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Tile({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div className="rounded-lg bg-background p-2">
      <p className="text-base font-bold sm:text-lg" style={{ color: colour ?? "var(--con-ink)" }}>{value}</p>
      <p className="text-xs text-secondary-500">{label}</p>
    </div>
  );
}
