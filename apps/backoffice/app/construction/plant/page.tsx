"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isUpgrade, kes } from "../../../lib/construction";
import { ConShell, useConMe } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../components/construction/ui";

interface Plant { id: string; name: string; regNo: string | null; ownership: "OWNED" | "HIRED"; hireRate: number | null; rateUnit: "HOUR" | "DAY"; supplier: { id: string; name: string } | null; project: { id: string; code: string } | null; isActive: boolean }
interface Option { id: string; name?: string; code?: string; status?: string }
const blank = { name: "", regNo: "", ownership: "OWNED" as "OWNED" | "HIRED", hireRate: "", rateUnit: "DAY" as "HOUR" | "DAY", supplierId: "", projectId: "" };

export default function PlantPage() {
  return (
    <ConShell title="Plant & equipment">
      <PlantRegister />
    </ConShell>
  );
}

function PlantRegister() {
  const me = useConMe();
  const canEdit = hasConRole(me, "CON_PROCUREMENT", "CON_CONTRACTS_MGR");
  const [rows, setRows] = useState<Plant[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<Plant[]>("/construction/plant"));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load plant."));
    }
  }, []);
  useEffect(() => {
    void load();
    apiGet<Option[]>("/suppliers").then(setSuppliers).catch(() => undefined);
    apiGet<Option[]>("/construction/projects").then((p) => setProjects(p.filter((x) => x.status !== "CLOSED"))).catch(() => undefined);
  }, [load]);

  async function save(isActive?: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body = { name: f.name, regNo: f.regNo || undefined, ownership: f.ownership, hireRate: f.hireRate ? Number(f.hireRate) : undefined, rateUnit: f.rateUnit, supplierId: f.supplierId || undefined, projectId: f.projectId || undefined, ...(isActive === undefined ? {} : { isActive }) };
      await conSend(editing ? "PUT" : "POST", `/construction/plant${editing ? `/${editing}` : ""}`, body);
      setF(blank);
      setEditing(null);
      setOpen(false);
      await load();
    } catch (e) {
      setError(errorText(e, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  if (upgrade) return <UpgradeCard message={upgrade} />;

  return (
    <div className="space-y-3">
      <ErrorBox message={error} />
      {canEdit && !open && <PrimaryButton onClick={() => (setF(blank), setEditing(null), setOpen(true))}>Add plant</PrimaryButton>}
      {open && (
        <Panel title={editing ? "Edit plant" : "Add plant"}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name"><input className={inputClass} value={f.name} placeholder="e.g. Excavator CAT 320" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Registration / serial no."><input className={inputClass} value={f.regNo} onChange={(e) => setF({ ...f, regNo: e.target.value })} /></Field>
            <Field label="Owned or hired">
              <select className={inputClass} value={f.ownership} onChange={(e) => setF({ ...f, ownership: e.target.value as "OWNED" | "HIRED" })}>
                <option value="OWNED">Owned</option>
                <option value="HIRED">Hired</option>
              </select>
            </Field>
            {f.ownership === "HIRED" && (
              <>
                <Field label="Hire rate (KES)"><input className={inputClass} inputMode="decimal" value={f.hireRate} onChange={(e) => setF({ ...f, hireRate: e.target.value })} /></Field>
                <Field label="Charged per">
                  <select className={inputClass} value={f.rateUnit} onChange={(e) => setF({ ...f, rateUnit: e.target.value as "HOUR" | "DAY" })}>
                    <option value="DAY">Day worked</option>
                    <option value="HOUR">Hour worked</option>
                  </select>
                </Field>
                <Field label="Hired from">
                  <select className={inputClass} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                    <option value="">Choose...</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </>
            )}
            <Field label="Now on project">
              <select className={inputClass} value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
                <option value="">In the yard</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <PrimaryButton disabled={busy || f.name.trim().length < 2 || (f.ownership === "HIRED" && !f.hireRate)} onClick={() => save()}>{busy ? "Saving..." : "Save"}</PrimaryButton>
            {editing && <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => save(!rows.find((r) => r.id === editing)?.isActive)}>{rows.find((r) => r.id === editing)?.isActive ? "No longer in use" : "Back in use"}</button>}
            <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => (setOpen(false), setEditing(null))}>Cancel</button>
          </div>
        </Panel>
      )}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`rounded-xl border border-border bg-surface p-3 ${r.isActive ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{r.name}{r.regNo ? ` (${r.regNo})` : ""}{!r.isActive && " - not in use"}</p>
                <p className="text-xs text-secondary-500">{r.ownership === "HIRED" ? `Hired from ${r.supplier?.name ?? "-"} at ${kes(r.hireRate ?? 0)}/${r.rateUnit === "DAY" ? "day" : "hour"}` : "Owned"}{r.project ? ` · on ${r.project.code}` : " · in the yard"}</p>
              </div>
              {canEdit && <button type="button" className="text-xs underline" style={{ color: CON_BRAND.orange }} onClick={() => (setEditing(r.id), setF({ name: r.name, regNo: r.regNo ?? "", ownership: r.ownership, hireRate: r.hireRate ? String(r.hireRate) : "", rateUnit: r.rateUnit, supplierId: r.supplier?.id ?? "", projectId: r.project?.id ?? "" }), setOpen(true))}>Edit</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
