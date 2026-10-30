"use client";

import { KENYA_COUNTIES } from "@zaroda/ui";
import { useState } from "react";
import { CON_BRAND, conSend, errorText, hasConRole, isDirector, kes, withChecks } from "../../../../lib/construction";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../../components/construction/ui";
import { NEXT_STATUS, STATUS_LABEL } from "../shared";
import type { TabProps } from "./types";

const FORMS: Record<string, string> = { JBC: "JBC", FIDIC: "FIDIC", PPADA: "Government (PPADA)", SIMPLE: "Simple agreement" };
const WORKS: Record<string, string> = { BUILDING: "Building works", ROADS_CIVIL: "Roads & civil works", ELEC_MECH: "Electrical & mechanical" };

export function OverviewTab({ project: p, reload }: TabProps) {
  const me = useConMe();
  const projectRole = (role: string) => !!me?.projectRoles.some((r) => r.projectId === p.id && r.role === role);
  const canEdit = p.status !== "CLOSED" && (hasConRole(me, "CON_CONTRACTS_MGR", "CON_QS") || projectRole("CON_PROJECT_MGR"));
  const canMove = hasConRole(me, "CON_CONTRACTS_MGR") || projectRole("CON_PROJECT_MGR");
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(() => toForm(p));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<string[]>([]);
  const diff = p.bqTotal - p.contractSum;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setBlocks([]);
    try {
      const r = await fn();
      if (r !== null) await reload();
      return r !== null;
    } catch (e) {
      const data = (e as { data?: { blocks?: string[] } }).data;
      if (data?.blocks?.length) setBlocks(data.blocks);
      else setError(errorText(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(() =>
      withChecks(
        (extra) =>
          conSend("PUT", `/construction/projects/${p.id}`, {
            code: f.code, name: f.name, clientId: p.client?.id, worksClass: f.worksClass, contractSum: Number(f.contractSum), formOfContract: f.formOfContract,
            startDate: f.startDate || undefined, completionDate: f.completionDate || undefined, dlpMonths: Number(f.dlpMonths), retentionRate: Number(f.retentionRate),
            retentionLimit: Number(f.retentionLimit), county: f.county || undefined, location: f.location || undefined, lat: f.lat ? Number(f.lat) : undefined, lng: f.lng ? Number(f.lng) : undefined, ...extra,
          }),
        isDirector(me),
      ),
    ).then((ok) => ok && setEditing(false));

  const move = (status: string) => {
    if (!window.confirm(`Move ${p.code} to ${STATUS_LABEL[status as keyof typeof STATUS_LABEL]}?`)) return;
    void run(() => withChecks((extra) => conSend("POST", `/construction/projects/${p.id}/status`, { status, ...extra }), false));
  };

  const useMyLocation = () =>
    navigator.geolocation?.getCurrentPosition(
      (pos) => setF((x) => ({ ...x, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) })),
      () => setError("Could not read your location - allow location access, or type it in."),
    );

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {blocks.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-semibold">This cannot go ahead yet:</p>
          <ul className="list-disc pl-5">{blocks.map((b) => <li key={b}>{b}</li>)}</ul>
          <p className="mt-1 text-xs">Record the permit under Permits (or ask the Director to change the rule in Settings).</p>
        </div>
      )}

      <Panel title="Contract" action={canEdit && !editing ? <button type="button" className="text-sm font-medium" style={{ color: CON_BRAND.orange }} onClick={() => (setF(toForm(p)), setEditing(true))}>Edit</button> : null}>
        {!editing ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Contract sum" value={kes(p.contractSum)} />
            <Row label="BQ total" value={<span>{kes(p.bqTotal)}{Math.abs(diff) >= 1 && <span className="ml-1 text-xs font-semibold text-red-700">({diff > 0 ? "+" : ""}{diff.toLocaleString("en-KE")} vs contract)</span>}</span>} />
            <Row label="Works class" value={WORKS[p.worksClass] ?? p.worksClass} />
            <Row label="Form of contract" value={FORMS[p.formOfContract] ?? p.formOfContract} />
            <Row label="Start" value={p.startDate ?? "-"} />
            <Row label="Completion" value={p.completionDate ?? "-"} />
            <Row label="Defects liability" value={`${p.dlpMonths} months`} />
            <Row label="Retention" value={`${p.retentionRate}% per certificate, up to ${p.retentionLimit}% of the contract sum`} />
            <Row label="Site" value={[p.location, p.county].filter(Boolean).join(", ") || "-"} />
            <Row label="GPS" value={p.lat !== null && p.lng !== null ? <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer" style={{ color: CON_BRAND.orange }}>{p.lat}, {p.lng}</a> : "-"} />
            {p.capOverrideReason && <Row label="NCA cap override" value={p.capOverrideReason} />}
          </dl>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code"><input className={inputClass} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
              <Field label="Name"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Contract sum (KES)"><input className={inputClass} inputMode="decimal" value={f.contractSum} onChange={(e) => setF({ ...f, contractSum: e.target.value })} /></Field>
              <Field label="Works class">
                <select className={inputClass} value={f.worksClass} onChange={(e) => setF({ ...f, worksClass: e.target.value })}>
                  {Object.entries(WORKS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Form of contract">
                <select className={inputClass} value={f.formOfContract} onChange={(e) => setF({ ...f, formOfContract: e.target.value })}>
                  {Object.entries(FORMS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Defects liability (months)"><input className={inputClass} inputMode="numeric" value={f.dlpMonths} onChange={(e) => setF({ ...f, dlpMonths: e.target.value })} /></Field>
              <Field label="Start"><input type="date" className={inputClass} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
              <Field label="Completion"><input type="date" className={inputClass} value={f.completionDate} onChange={(e) => setF({ ...f, completionDate: e.target.value })} /></Field>
              <Field label="Retention per certificate (%)"><input className={inputClass} inputMode="decimal" value={f.retentionRate} onChange={(e) => setF({ ...f, retentionRate: e.target.value })} /></Field>
              <Field label="Retention cap (% of contract sum)"><input className={inputClass} inputMode="decimal" value={f.retentionLimit} onChange={(e) => setF({ ...f, retentionLimit: e.target.value })} /></Field>
              <Field label="County">
                <select className={inputClass} value={f.county} onChange={(e) => setF({ ...f, county: e.target.value })}>
                  <option value="">Choose...</option>
                  {KENYA_COUNTIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Site location"><input className={inputClass} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
              <Field label="Latitude"><input className={inputClass} inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></Field>
              <Field label="Longitude"><input className={inputClass} inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <PrimaryButton disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</PrimaryButton>
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={useMyLocation}>Use my location (on site)</button>
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </>
        )}
      </Panel>

      {canMove && NEXT_STATUS[p.status].length > 0 && (
        <Panel title="Project status">
          <p className="mb-3 text-sm text-secondary-600">
            Going Active checks the NCA project registration, county plans, building permit, NEMA, DOSHS, WIBA cover and that the BQ matches the contract sum.
          </p>
          <div className="flex flex-wrap gap-2">
            {NEXT_STATUS[p.status].map((s) => (
              <button key={s} type="button" disabled={busy} onClick={() => move(s)} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: s === "CLOSED" ? "#6b7280" : CON_BRAND.navy }}>
                Move to {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-secondary-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function toForm(p: TabProps["project"]) {
  return {
    code: p.code, name: p.name, contractSum: String(p.contractSum), worksClass: p.worksClass, formOfContract: p.formOfContract, dlpMonths: String(p.dlpMonths),
    startDate: p.startDate ?? "", completionDate: p.completionDate ?? "", retentionRate: String(p.retentionRate), retentionLimit: String(p.retentionLimit),
    county: p.county ?? "", location: p.location ?? "", lat: p.lat === null ? "" : String(p.lat), lng: p.lng === null ? "" : String(p.lng),
  };
}
