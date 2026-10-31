"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isDirector } from "../../../../../lib/construction";
import { todayEat } from "../../../../../lib/con-site";
import { ConShell, useConMe } from "../../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../../../components/construction/ui";

interface Worker { id: string; name: string; trade: string }
interface Registers {
  talks: { id: string; date: string; topic: string; attendees: number }[];
  ppe: { id: string; worker: string; item: string; qty: number; issuedAt: string }[];
  permits: { id: string; number: string; type: string; location: string; precautions: string | null; validFrom: string; validTo: string; status: "OPEN" | "CLOSED" | "CANCELLED" | "EXPIRED" }[];
  incidents: { id: string; occurredAt: string; severity: string; description: string; actionTaken: string | null; worker: string | null; mustReport: boolean; reportDueAt: string | null; reportedToDoshs: boolean; reportedAt: string | null; doshsRef: string | null; overdue: boolean }[];
}

const PERMIT_TYPES: Record<string, string> = { HEIGHT: "Work at height", HOT_WORK: "Hot works (welding, cutting)", EXCAVATION: "Excavation", CONFINED: "Confined space", ELECTRICAL: "Electrical isolation" };
const SEVERITY: Record<string, { label: string; colour: string }> = {
  NEAR_MISS: { label: "Near miss", colour: "#6b7280" },
  MINOR: { label: "Minor (first aid)", colour: CON_BRAND.orange },
  LOST_TIME: { label: "Lost time (off work)", colour: "#dc2626" },
  FATAL: { label: "Fatal", colour: "#7f1d1d" },
};
const PPE_ITEMS = ["Safety helmet", "Safety boots", "Reflective vest", "Gloves", "Goggles", "Dust mask", "Ear protection", "Harness"];
const localDateTime = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function SafetyPage() {
  return (
    <ConShell title="Safety">
      <Safety />
    </ConShell>
  );
}

function Safety() {
  const { projectId } = useParams<{ projectId: string }>();
  const me = useConMe();
  const onProject = (...roles: string[]) => isDirector(me) || !!me?.projectRoles.some((r) => r.projectId === projectId && roles.includes(r.role));
  const canEdit = hasConRole(me, "CON_SHE_OFFICER") || onProject("CON_SITE_ENGINEER", "CON_SITE_SUPERVISOR");
  const canReport = hasConRole(me, "CON_SHE_OFFICER") || onProject("CON_PROJECT_MGR");
  const [reg, setReg] = useState<Registers | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [open, setOpen] = useState<"talk" | "ppe" | "permit" | "incident" | null>(null);
  const [talk, setTalk] = useState({ topic: "", notes: "", attendees: [] as string[] });
  const [ppe, setPpe] = useState({ workerId: "", item: PPE_ITEMS[0], qty: "1" });
  const [permit, setPermit] = useState({ type: "HEIGHT", location: "", precautions: "", validFrom: localDateTime(), validTo: localDateTime(new Date(Date.now() + 86_400_000)) });
  const [incident, setIncident] = useState({ occurredAt: localDateTime(), severity: "MINOR", description: "", actionTaken: "", workerId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReg(await apiGet<Registers>(`/construction/projects/${projectId}/safety`));
      setWorkers(await apiGet<Worker[]>(`/construction/workers?projectId=${projectId}`).catch(() => []));
    } catch (e) {
      setError(errorText(e, "Could not load the safety registers."));
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      setOpen(null);
      await load();
    } catch (e) {
      setError(errorText(e, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  const iso = (local: string) => new Date(local).toISOString();
  const unreported = reg?.incidents.filter((i) => i.mustReport && !i.reportedToDoshs) ?? [];

  return (
    <div className="space-y-3">
      <Link href="/construction/site" className="text-sm" style={{ color: CON_BRAND.orange }}>← Site</Link>
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      {unreported.map((i) => (
        <p key={i.id} className="rounded-xl px-3 py-2 text-sm font-medium text-white" style={{ background: i.overdue ? "#7f1d1d" : "#dc2626" }}>
          {i.overdue ? "OVERDUE: " : ""}Report the {SEVERITY[i.severity].label.toLowerCase()} incident of {new Date(i.occurredAt).toLocaleDateString("en-KE")} to DOSHS by {i.reportDueAt ? new Date(i.reportDueAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "-"}.
        </p>
      ))}

      {canEdit && (
        <div className="grid grid-cols-2 gap-2">
          {([["talk", "Toolbox talk"], ["ppe", "Issue PPE"], ["permit", "Permit to work"], ["incident", "Report incident"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setOpen(open === k ? null : k)} className="min-h-[56px] rounded-xl text-base font-bold text-white" style={{ background: k === "incident" ? "#dc2626" : CON_BRAND.navy }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {open === "talk" && (
        <Panel title="Toolbox talk (today)">
          <Field label="Topic"><input className={`${inputClass} text-base`} value={talk.topic} placeholder="e.g. Working at height" onChange={(e) => setTalk({ ...talk, topic: e.target.value })} /></Field>
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium text-secondary-600">Who attended ({talk.attendees.length})</span><button type="button" className="underline" onClick={() => setTalk({ ...talk, attendees: talk.attendees.length === workers.length ? [] : workers.map((w) => w.id) })}>{talk.attendees.length === workers.length ? "None" : "All"}</button></div>
            <div className="grid grid-cols-2 gap-1">
              {workers.map((w) => (
                <label key={w.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={talk.attendees.includes(w.id)} onChange={(e) => setTalk({ ...talk, attendees: e.target.checked ? [...talk.attendees, w.id] : talk.attendees.filter((x) => x !== w.id) })} />
                  {w.name}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-3"><PrimaryButton disabled={busy || talk.topic.trim().length < 3} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/toolbox-talks`, { date: todayEat(), topic: talk.topic, notes: talk.notes || undefined, attendeeIds: talk.attendees }), "Toolbox talk recorded.").then(() => setTalk({ topic: "", notes: "", attendees: [] }))}>Save talk</PrimaryButton></div>
        </Panel>
      )}

      {open === "ppe" && (
        <Panel title="Issue PPE">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Worker">
              <select className={`${inputClass} text-base`} value={ppe.workerId} onChange={(e) => setPpe({ ...ppe, workerId: e.target.value })}>
                <option value="">Choose...</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Item">
              <select className={`${inputClass} text-base`} value={ppe.item} onChange={(e) => setPpe({ ...ppe, item: e.target.value })}>
                {PPE_ITEMS.map((i) => <option key={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="How many"><input className={`${inputClass} text-base`} inputMode="numeric" value={ppe.qty} onChange={(e) => setPpe({ ...ppe, qty: e.target.value.replace(/\D/g, "") })} /></Field>
          </div>
          <div className="mt-3"><PrimaryButton disabled={busy || !ppe.workerId} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/ppe`, { workerId: ppe.workerId, item: ppe.item, qty: Number(ppe.qty) || 1, issuedAt: todayEat() }), "PPE issue recorded.")}>Record issue</PrimaryButton></div>
        </Panel>
      )}

      {open === "permit" && (
        <Panel title="Permit to work">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Type">
              <select className={`${inputClass} text-base`} value={permit.type} onChange={(e) => setPermit({ ...permit, type: e.target.value })}>
                {Object.entries(PERMIT_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Where"><input className={`${inputClass} text-base`} value={permit.location} onChange={(e) => setPermit({ ...permit, location: e.target.value })} /></Field>
            <Field label="From"><input type="datetime-local" className={`${inputClass} text-base`} value={permit.validFrom} onChange={(e) => setPermit({ ...permit, validFrom: e.target.value })} /></Field>
            <Field label="Until"><input type="datetime-local" className={`${inputClass} text-base`} value={permit.validTo} onChange={(e) => setPermit({ ...permit, validTo: e.target.value })} /></Field>
          </div>
          <Field label="Precautions"><textarea className={`${inputClass} text-base`} value={permit.precautions} onChange={(e) => setPermit({ ...permit, precautions: e.target.value })} /></Field>
          <div className="mt-3"><PrimaryButton disabled={busy || permit.location.trim().length < 2} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/work-permits`, { type: permit.type, location: permit.location, precautions: permit.precautions || undefined, validFrom: iso(permit.validFrom), validTo: iso(permit.validTo) }), "Permit issued.")}>Issue permit</PrimaryButton></div>
        </Panel>
      )}

      {open === "incident" && (
        <Panel title="Report an incident">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="When"><input type="datetime-local" className={`${inputClass} text-base`} value={incident.occurredAt} onChange={(e) => setIncident({ ...incident, occurredAt: e.target.value })} /></Field>
            <Field label="How serious">
              <select className={`${inputClass} text-base`} value={incident.severity} onChange={(e) => setIncident({ ...incident, severity: e.target.value })}>
                {Object.entries(SEVERITY).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Worker (if any)">
              <select className={`${inputClass} text-base`} value={incident.workerId} onChange={(e) => setIncident({ ...incident, workerId: e.target.value })}>
                <option value="">Nobody hurt / not a worker</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="What happened"><textarea className={`${inputClass} min-h-[90px] text-base`} value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} /></Field>
          <Field label="Action taken"><textarea className={`${inputClass} text-base`} value={incident.actionTaken} onChange={(e) => setIncident({ ...incident, actionTaken: e.target.value })} /></Field>
          {(incident.severity === "LOST_TIME" || incident.severity === "FATAL") && <p className="mt-2 text-sm font-semibold text-red-700">This must be reported to DOSHS within {incident.severity === "FATAL" ? "24 hours" : "7 days"}.</p>}
          <div className="mt-3"><PrimaryButton disabled={busy || incident.description.trim().length < 5} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/incidents`, { occurredAt: iso(incident.occurredAt), severity: incident.severity, description: incident.description, actionTaken: incident.actionTaken || undefined, workerId: incident.workerId || undefined }), "Incident recorded.")}>Save incident</PrimaryButton></div>
        </Panel>
      )}

      {reg && (
        <>
          <Panel title={`Incidents (${reg.incidents.length})`}>
            {reg.incidents.length === 0 && <p className="text-sm text-secondary-500">None recorded.</p>}
            <ul className="divide-y divide-border text-sm">
              {reg.incidents.map((i) => (
                <li key={i.id} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0">{i.description}</p>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: SEVERITY[i.severity].colour }}>{SEVERITY[i.severity].label}</span>
                  </div>
                  <p className="text-xs text-secondary-500">{new Date(i.occurredAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}{i.worker ? ` · ${i.worker}` : ""}{i.actionTaken ? ` · ${i.actionTaken}` : ""}</p>
                  {i.mustReport && (i.reportedToDoshs ? (
                    <p className="text-xs text-green-700">Reported to DOSHS {i.reportedAt ? new Date(i.reportedAt).toLocaleDateString("en-KE") : ""} · ref {i.doshsRef}</p>
                  ) : canReport ? (
                    <button type="button" className="mt-1 text-xs font-semibold underline" style={{ color: "#dc2626" }} onClick={() => { const ref = window.prompt("DOSHS reference number"); if (ref?.trim()) void run(() => conSend("POST", `/construction/projects/${projectId}/incidents/${i.id}/doshs`, { doshsRef: ref.trim() }), "DOSHS report recorded."); }}>Record DOSHS report</button>
                  ) : null)}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Permits to work">
            {reg.permits.length === 0 && <p className="text-sm text-secondary-500">None issued.</p>}
            <ul className="divide-y divide-border text-sm">
              {reg.permits.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{p.number} · {PERMIT_TYPES[p.type]}</p>
                    <p className="text-xs text-secondary-500">{p.location} · until {new Date(p.validTo).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: p.status === "OPEN" ? "#16a34a" : p.status === "EXPIRED" ? "#dc2626" : "#6b7280" }}>{p.status}</span>
                    {canEdit && (p.status === "OPEN" || p.status === "EXPIRED") && <button type="button" className="text-xs underline" onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/work-permits/${p.id}/close`), "Permit closed.")}>Close</button>}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Toolbox talks">
            {reg.talks.length === 0 && <p className="text-sm text-secondary-500">None yet.</p>}
            <ul className="divide-y divide-border text-sm">{reg.talks.map((t) => <li key={t.id} className="flex justify-between gap-2 py-2"><span>{t.topic}</span><span className="text-xs text-secondary-500">{t.date} · {t.attendees} attended</span></li>)}</ul>
          </Panel>
          <Panel title="PPE issued">
            {reg.ppe.length === 0 && <p className="text-sm text-secondary-500">None yet.</p>}
            <ul className="divide-y divide-border text-sm">{reg.ppe.slice(0, 30).map((p) => <li key={p.id} className="flex justify-between gap-2 py-1.5"><span>{p.worker}</span><span className="text-xs text-secondary-500">{p.qty} × {p.item} · {p.issuedAt}</span></li>)}</ul>
          </Panel>
        </>
      )}
    </div>
  );
}
