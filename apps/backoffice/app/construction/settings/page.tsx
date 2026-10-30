"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../../../lib/api";
import { errorText, hasConRole, isDirector, kes } from "../../../lib/construction";
import { ConShell, useConMe } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../components/construction/ui";

interface Tax { id: string; key: string; rate: number; threshold: number | null; active: boolean; effectiveFrom: string; notes: string | null; current: boolean; upcoming: boolean }
interface Cap { id: string; worksClass: string; ncaCategory: number; maxValue: number | null }
interface RoleRow { code: string; name: string; scope: string; approvalLimit: number | null }

const TAX_KEYS = ["VAT", "WHT_CONTRACTOR", "WHT_VAT", "NCA_LEVY", "RETENTION_DEFAULT", "RETENTION_LIMIT", "SHIF", "HOUSING_LEVY", "NSSF"];
const WORKS: Record<string, string> = { BUILDING: "Building", ELEC_MECH: "Elec/Mech", ROADS_CIVIL: "Roads & civil" };

export default function SettingsPage() {
  return (
    <ConShell title="Settings">
      <Settings />
    </ConShell>
  );
}

function Settings() {
  const me = useConMe();
  const [tax, setTax] = useState<Tax[]>([]);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ key: "VAT", rate: "", threshold: "", active: true, effectiveFrom: "", notes: "" });

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([apiGet<Tax[]>("/construction/settings/tax"), apiGet<RoleRow[]>("/construction/roles")]);
      setTax(t);
      setRoles(r);
      setCaps(await apiGet<Cap[]>("/construction/compliance/limits").catch(() => []));
    } catch (e) {
      setError(errorText(e, "Could not load settings."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = (fn: () => Promise<unknown>) => fn().then(load).then(() => setError(null)).catch((e) => setError(errorText(e, "That did not work.")));
  const askAmount = (label: string, current: number | null) => {
    const v = prompt(`${label} (KES). Leave empty for unlimited.`, current === null ? "" : String(current));
    if (v === null) return undefined;
    const n = Number(v.replace(/,/g, ""));
    return v.trim() === "" ? null : Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const byClass = Object.keys(WORKS).map((w) => ({ w, rows: caps.filter((c) => c.worksClass === w) }));

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <RulesPanel canEdit={isDirector(me)} onError={setError} />
      <Panel title="Tax and statutory rates">
        <p className="mb-3 text-xs text-secondary-500">The law changes these. A change is a new rate from its effective date; earlier rates stay for past documents. Check figures with KRA/NCA before relying on them.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-secondary-500">
              <tr><th className="py-1">Rate</th><th>%</th><th>Threshold</th><th>From</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tax.map((t) => (
                <tr key={t.id} className={t.current ? "font-medium" : "text-secondary-500"}>
                  <td className="py-1.5">{t.key}{!t.active && " (off)"}</td>
                  <td>{t.rate}</td>
                  <td>{t.threshold === null ? "-" : kes(t.threshold)}</td>
                  <td>{t.effectiveFrom}</td>
                  <td className="text-xs">{t.current ? "current" : t.upcoming ? "upcoming" : "past"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasConRole(me, "CON_ACCOUNTANT") && (
          <div className="mt-3 grid gap-2 sm:grid-cols-6">
            <Field label="Rate">
              <select className={inputClass} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}>
                {TAX_KEYS.map((k) => <option key={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="%"><input className={inputClass} inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></Field>
            <Field label="Threshold"><input className={inputClass} inputMode="decimal" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></Field>
            <Field label="From"><input type="date" className={inputClass} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
            <Field label="On">
              <select className={inputClass} value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                <option value="1">On</option>
                <option value="0">Off</option>
              </select>
            </Field>
            <div className="flex items-end">
              <PrimaryButton
                disabled={!form.rate || !form.effectiveFrom}
                onClick={() => act(() => apiPost("/construction/settings/tax", { key: form.key, rate: Number(form.rate), threshold: form.threshold ? Number(form.threshold) : undefined, active: form.active, effectiveFrom: form.effectiveFrom })).then(() => setForm({ ...form, rate: "", threshold: "", effectiveFrom: "" }))}
              >
                Add rate
              </PrimaryButton>
            </div>
          </div>
        )}
      </Panel>

      {caps.length > 0 && (
        <Panel title="NCA category caps (KES)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-secondary-500">
                <tr><th className="py-1">Category</th>{byClass.map((c) => <th key={c.w}>{WORKS[c.w]}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <tr key={n}>
                    <td className="py-1.5 font-medium">NCA{n}</td>
                    {byClass.map(({ w, rows }) => {
                      const cap = rows.find((r) => r.ncaCategory === n);
                      return (
                        <td key={w}>
                          {cap && hasConRole(me, "CON_COMPLIANCE") ? (
                            <button type="button" className="underline decoration-dotted" onClick={() => { const v = askAmount(`NCA${n} ${WORKS[w]} cap`, cap.maxValue); if (v !== undefined) void act(() => apiPatch(`/construction/compliance/limits/${cap.id}`, { maxValue: v })); }}>
                              {kes(cap.maxValue)}
                            </button>
                          ) : (
                            kes(cap?.maxValue ?? null)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Roles and approval limits">
        <ul className="divide-y divide-border text-sm">
          {roles.map((r) => (
            <li key={r.code} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-secondary-500">{r.scope === "COMPANY" ? "Company-wide" : r.scope === "PROJECT" ? "Per project" : "External (portal, free)"}</p>
              </div>
              {r.scope !== "EXTERNAL" &&
                (isDirector(me) && r.code !== "CON_DIRECTOR" ? (
                  <button type="button" className="text-sm underline decoration-dotted" onClick={() => { const v = askAmount(`Most a ${r.name} may approve`, r.approvalLimit); if (v !== undefined) void act(() => apiPatch(`/construction/roles/${r.code}`, { approvalLimit: v })); }}>
                    {r.approvalLimit === null ? "Cannot approve - set a limit" : `Approves up to ${kes(r.approvalLimit)}`}
                  </button>
                ) : (
                  <span className="text-xs text-secondary-600">{r.code === "CON_DIRECTOR" ? "Approves anything" : r.approvalLimit === null ? "Cannot approve" : `Up to ${kes(r.approvalLimit)}`}</span>
                ))}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function RulesPanel({ canEdit, onError }: { canEdit: boolean; onError: (m: string | null) => void }) {
  const [rule, setRule] = useState<"BLOCK" | "WARN" | null>(null);
  useEffect(() => {
    apiGet<{ ncaProjectRegRule: "BLOCK" | "WARN" }>("/construction/settings/rules").then((r) => setRule(r.ncaProjectRegRule)).catch(() => undefined);
  }, []);
  const change = (next: "BLOCK" | "WARN") =>
    apiPatch<{ ncaProjectRegRule: "BLOCK" | "WARN" }>("/construction/settings/rules", { ncaProjectRegRule: next })
      .then((r) => (setRule(r.ncaProjectRegRule), onError(null)))
      .catch((e) => onError(errorText(e, "Could not save the rule.")));
  if (!rule) return null;
  return (
    <Panel title="Project rules">
      <p className="text-sm text-secondary-600">When a project goes Active without an approved NCA project registration:</p>
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" disabled={!canEdit} checked={rule === "BLOCK"} onChange={() => change("BLOCK")} /> Stop it (recommended)</label>
        <label className="flex items-center gap-2"><input type="radio" disabled={!canEdit} checked={rule === "WARN"} onChange={() => change("WARN")} /> Warn, then allow</label>
      </div>
      {!canEdit && <p className="mt-1 text-xs text-secondary-500">Only the Director can change this.</p>}
    </Panel>
  );
}
