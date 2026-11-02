"use client";

import { useState } from "react";
import { CON_BRAND, conSend, errorText, hasConRole } from "../../../../lib/construction";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../../components/construction/ui";
import type { ProjectDetail, TabProps } from "./types";

type Milestone = ProjectDetail["milestones"][number];
const DAY = 86_400_000;
const at = (s: string) => Date.parse(`${s}T00:00:00Z`);
const blank = { name: "", startDate: "", endDate: "", percentComplete: "0" };

/** Milestones as a simple Gantt: one bar per milestone across the programme, filled to its percent complete, with today marked. */
export function ProgrammeTab({ project: p, reload }: TabProps) {
  const me = useConMe();
  const canEdit = p.status !== "CLOSED" && (hasConRole(me, "CON_CONTRACTS_MGR") || !!me?.projectRoles.some((r) => r.projectId === p.id && r.role === "CON_PROJECT_MGR"));
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ms = p.milestones;
  const start = Math.min(...ms.map((m) => at(m.startDate)), p.startDate ? at(p.startDate) : Infinity);
  const end = Math.max(...ms.map((m) => at(m.endDate)), p.completionDate ? at(p.completionDate) : -Infinity);
  const span = Math.max(end - start + DAY, DAY);
  const pos = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / span) * 100))}%`;
  const today = Date.now();

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(errorText(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(() =>
      conSend(editing ? "PUT" : "POST", `/construction/projects/${p.id}/milestones${editing ? `/${editing}` : ""}`, { name: form.name.trim(), startDate: form.startDate, endDate: form.endDate, percentComplete: Number(form.percentComplete), sortOrder: editing ? ms.find((m) => m.id === editing)?.sortOrder : ms.length }),
    ).then((ok) => ok && (setForm(blank), setEditing(null)));

  const setPercent = (m: Milestone) => {
    const v = window.prompt(`${m.name}: percent complete (0-100)`, String(m.percentComplete));
    if (v === null) return;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 100) return setError("Enter a number from 0 to 100.");
    void run(() => conSend("PUT", `/construction/projects/${p.id}/milestones/${m.id}`, { name: m.name, startDate: m.startDate, endDate: m.endDate, percentComplete: n, sortOrder: m.sortOrder }));
  };

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <Panel title={`Programme - ${p.progress}% done`}>
        {ms.length === 0 ? (
          <p className="text-sm text-secondary-500">No milestones yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between text-xs text-secondary-500">
              <span>{new Date(start).toISOString().slice(0, 10)}</span>
              <span>{new Date(end).toISOString().slice(0, 10)}</span>
            </div>
            {ms.map((m) => {
              const late = at(m.endDate) + DAY < today && m.percentComplete < 100;
              return (
                <div key={m.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-secondary-500">
                      {m.startDate} to {m.endDate} ·{" "}
                      {canEdit ? <button type="button" className="font-semibold underline" style={{ color: CON_BRAND.orange }} onClick={() => setPercent(m)}>{m.percentComplete}%</button> : `${m.percentComplete}%`}
                      {late && <span className="ml-1 font-semibold text-red-700">behind</span>}
                    </span>
                  </div>
                  <div className="relative mt-1 h-5 rounded bg-background">
                    <div className="absolute top-0 h-5 rounded" style={{ left: pos(at(m.startDate)), width: `calc(${pos(at(m.endDate) + DAY)} - ${pos(at(m.startDate))})`, background: late ? "#fecaca" : "#cbd5e1" }}>
                      <div className="h-5 rounded" style={{ width: `${m.percentComplete}%`, background: m.percentComplete === 100 ? "#16a34a" : CON_BRAND.gold }} />
                    </div>
                    {today >= start && today <= end + DAY && <div className="absolute top-[-3px] h-[26px] w-0.5" style={{ left: pos(today), background: CON_BRAND.orange }} title="Today" />}
                  </div>
                  {canEdit && (
                    <div className="mt-1 flex gap-3 text-xs">
                      <button type="button" className="underline" onClick={() => (setEditing(m.id), setForm({ name: m.name, startDate: m.startDate, endDate: m.endDate, percentComplete: String(m.percentComplete) }))}>Edit</button>
                      <button type="button" className="text-red-700" onClick={() => window.confirm(`Delete ${m.name}?`) && run(() => conSend("DELETE", `/construction/projects/${p.id}/milestones/${m.id}`))}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-secondary-500"><span style={{ color: CON_BRAND.orange }}>|</span> today · bars fill as work is done · red = past its end date and not finished</p>
          </div>
        )}
      </Panel>

      {canEdit && (
        <Panel title={editing ? "Edit milestone" : "Add a milestone"}>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Name"><input className={inputClass} value={form.name} placeholder="e.g. Roofing" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Start"><input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="End"><input type="date" className={inputClass} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            <Field label="% complete"><input className={inputClass} inputMode="numeric" value={form.percentComplete} onChange={(e) => setForm({ ...form, percentComplete: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex gap-2">
            <PrimaryButton disabled={busy || form.name.trim().length < 2 || !form.startDate || !form.endDate} onClick={save}>{editing ? "Save" : "Add milestone"}</PrimaryButton>
            {editing && <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => (setEditing(null), setForm(blank))}>Cancel</button>}
          </div>
        </Panel>
      )}
    </div>
  );
}
