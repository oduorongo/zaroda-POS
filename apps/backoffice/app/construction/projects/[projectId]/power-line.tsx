"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { CON_BRAND, conOpenFile, conSend, errorText, hasConRole, isUpgrade, kes, type ConMe } from "../../../../lib/construction";
import { todayEat } from "../../../../lib/con-site";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

type Measure = "poles" | "stays" | "conductorKm" | "transformers" | "services";
const MEASURES: [Measure, string][] = [["poles", "Poles erected"], ["stays", "Stays"], ["conductorKm", "Conductor strung (km)"], ["transformers", "Transformers"], ["services", "Service connections"]];
export interface Section {
  id: string;
  code: string;
  name: string;
  fromKm: number | null;
  toKm: number | null;
  targets: Record<Measure, number>;
  measures: { measure: Measure; label: string; target: number; done: number; percent: number | null }[];
  percent: number | null;
  entries: ({ date: string; crew: string | null; notes: string | null } & Record<Measure, number>)[];
}
interface Overview {
  progress: { percent: number | null; measures: Section["measures"] };
  sections: Section[];
  wayleaves: { counts: { total: number; agreed: number; pending: number; refused: number }; compensation: number; rows: { id: string; section: string | null; landowner: string; phone: string | null; parcelNo: string | null; chainageKm: number | null; status: string; compensation: number | null; agreedAt: string | null; hasFile: boolean }[] };
  crossings: { id: string; section: string | null; kind: string; authority: string; refNo: string | null; status: string; approvedAt: string | null; expiresAt: string | null; state: string; daysLeft: number | null; hasFile: boolean }[];
  assets: { id: string; section: string | null; kind: string; tag: string; serialNo: string | null; spec: string | null; lat: number | null; lng: number | null; installedAt: string | null; note: string | null }[];
}
export interface ClientMaterials {
  sections: { id: string; code: string; name: string }[];
  items: { id: string; code: string; description: string; unit: string; received: number; issued: number; returned: number; damaged: number; onHand: number }[];
  moves: { id: string; itemId: string; kind: string; quantity: number; section: string | null; moveDate: string; reference: string | null; note: string | null }[];
}

/** Whether this person holds one of the roles, company-wide or on this project (the Director always does). */
export const canOn = (me: ConMe | null, projectId: string, roles: string[]) => hasConRole(me, ...roles) || !!me?.projectRoles.some((r) => r.projectId === projectId && roles.includes(r.role));
export const SITE_EDIT = ["CON_PROJECT_MGR", "CON_SITE_ENGINEER", "CON_SITE_SUPERVISOR"];
const LAND_EDIT = ["CON_CONTRACTS_MGR", "CON_PROJECT_MGR", "CON_COMPLIANCE"];
export const MAT_EDIT = ["CON_PROJECT_MGR", "CON_SITE_SUPERVISOR", "CON_STOREKEEPER"];
const n = (v: string) => (v.trim() === "" ? undefined : Number(v));

function csv(name: string, rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const blob = new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function Bar({ percent }: { percent: number | null }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-secondary-500/20">
      <div className="h-full" style={{ width: `${percent ?? 0}%`, background: CON_BRAND.orange }} />
    </div>
  );
}

/** A section's progress for a day (one entry per section per day; saving again replaces it). Also on the phone screen. */
export function ProgressForm({ projectId, sections, onSaved }: { projectId: string; sections: { id: string; code: string; name: string }[]; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ sectionId: "", date: todayEat(), poles: "", stays: "", conductorKm: "", transformers: "", services: "", crew: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await conSend("PUT", `/construction/projects/${projectId}/sections/${f.sectionId}/progress/${f.date}`, { poles: n(f.poles), stays: n(f.stays), conductorKm: n(f.conductorKm), transformers: n(f.transformers), services: n(f.services), crew: f.crew || undefined, notes: f.notes || undefined });
      setDone("Saved.");
      onSaved();
    } catch (e) {
      setError(errorText(e, "Could not save the progress."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Section">
          <select className={inputClass} value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}>
            <option value="">Choose...</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
          </select>
        </Field>
        <Field label="Day"><input type="date" max={todayEat()} className={inputClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {MEASURES.map(([k, label]) => (
          <Field key={k} label={label}><input type="number" min={0} step={k === "conductorKm" ? "0.001" : "1"} inputMode="decimal" className={inputClass} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Crew"><input className={inputClass} value={f.crew} onChange={(e) => setF({ ...f, crew: e.target.value })} /></Field>
        <Field label="Notes"><input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <ErrorBox message={error} />
      {done && <p className="text-sm text-secondary-500">{done}</p>}
      <PrimaryButton disabled={busy || !f.sectionId} onClick={() => void save()}>{busy ? "Saving..." : "Save the day's progress"}</PrimaryButton>
    </div>
  );
}

/** Records something installed on the line, with the phone's GPS position if wanted. Also on the phone screen. */
export function AssetForm({ projectId, sections, onSaved }: { projectId: string; sections: { id: string; code: string; name: string }[]; onSaved: () => void }) {
  const [f, setF] = useState({ kind: "POLE", tag: "", serialNo: "", spec: "", sectionId: "", lat: "", lng: "", installedAt: todayEat(), note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  function locate() {
    if (!navigator.geolocation) return setError("This device cannot give its position.");
    navigator.geolocation.getCurrentPosition(
      (pos) => setF((x) => ({ ...x, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) })),
      () => setError("Could not get the position. Allow location for this site, then try again."),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }
  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await conSend("POST", `/construction/projects/${projectId}/line-assets`, { kind: f.kind, tag: f.tag, serialNo: f.serialNo || undefined, spec: f.spec || undefined, sectionId: f.sectionId || undefined, lat: n(f.lat), lng: n(f.lng), installedAt: f.installedAt || undefined, note: f.note || undefined });
      setDone(`${f.kind.toLowerCase()} ${f.tag.toUpperCase()} recorded.`);
      setF({ ...f, tag: "", serialNo: "", lat: "", lng: "", note: "" });
      onSaved();
    } catch (e) {
      setError(errorText(e, "Could not record it."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="What">
          <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {["POLE", "STAY", "TRANSFORMER", "SWITCHGEAR", "SERVICE", "OTHER"].map((k) => <option key={k} value={k}>{k.charAt(0) + k.slice(1).toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="Number / tag"><input className={inputClass} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="P-001" /></Field>
        <Field label="Section">
          <select className={inputClass} value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}>
            <option value="">None</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
        </Field>
        <Field label="Installed"><input type="date" max={todayEat()} className={inputClass} value={f.installedAt} onChange={(e) => setF({ ...f, installedAt: e.target.value })} /></Field>
        <Field label="Specification"><input className={inputClass} value={f.spec} onChange={(e) => setF({ ...f, spec: e.target.value })} placeholder="11m wooden pole" /></Field>
        <Field label="Serial no."><input className={inputClass} value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} /></Field>
        <Field label="Latitude"><input className={inputClass} inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></Field>
        <Field label="Longitude"><input className={inputClass} inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" onClick={locate}>Use my position</button>
        <PrimaryButton disabled={busy || !f.tag.trim()} onClick={() => void save()}>{busy ? "Saving..." : "Record"}</PrimaryButton>
      </div>
      <ErrorBox message={error} />
      {done && <p className="text-sm text-secondary-500">{done}</p>}
    </div>
  );
}

/** Client-supplied materials: received, issued (to a section), returned or damaged. Also on the phone screen. */
export function ClientMoveForm({ projectId, data, onSaved }: { projectId: string; data: ClientMaterials; onSaved: () => void }) {
  const [f, setF] = useState({ itemId: "", kind: "ISSUED", quantity: "", sectionId: "", moveDate: todayEat(), reference: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = data.items.find((i) => i.id === f.itemId);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await conSend("POST", `/construction/projects/${projectId}/client-materials/moves`, { itemId: f.itemId, kind: f.kind, quantity: Number(f.quantity), sectionId: f.kind === "ISSUED" && f.sectionId ? f.sectionId : undefined, moveDate: f.moveDate, reference: f.reference || undefined, note: f.note || undefined });
      setF({ ...f, quantity: "", reference: "", note: "" });
      onSaved();
    } catch (e) {
      setError(errorText(e, "Could not record it."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Item">
          <select className={inputClass} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
            <option value="">Choose...</option>
            {data.items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.description}</option>)}
          </select>
        </Field>
        <Field label="What happened">
          <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="RECEIVED">Received from the client</option>
            <option value="ISSUED">Issued to the works</option>
            <option value="RETURNED">Returned to the client</option>
            <option value="DAMAGED">Damaged / written off</option>
          </select>
        </Field>
        <Field label={`Quantity${item ? ` (${item.unit}, ${item.onHand} on hand)` : ""}`}><input type="number" min={0} step="0.001" inputMode="decimal" className={inputClass} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        {f.kind === "ISSUED" ? (
          <Field label="To section">
            <select className={inputClass} value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}>
              <option value="">None</option>
              {data.sections.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Delivery / return note"><input className={inputClass} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        )}
        <Field label="Date"><input type="date" max={todayEat()} className={inputClass} value={f.moveDate} onChange={(e) => setF({ ...f, moveDate: e.target.value })} /></Field>
        <Field label="Note"><input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <ErrorBox message={error} />
      <PrimaryButton disabled={busy || !f.itemId || !(Number(f.quantity) > 0)} onClick={() => void save()}>{busy ? "Saving..." : "Record"}</PrimaryButton>
    </div>
  );
}

export function ClientItemsTable({ data }: { data: ClientMaterials }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-secondary-500"><tr><th className="p-1">Item</th><th className="p-1 text-right">Received</th><th className="p-1 text-right">Issued</th><th className="p-1 text-right">Returned</th><th className="p-1 text-right">Damaged</th><th className="p-1 text-right">On hand</th></tr></thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.id} className="border-t border-border">
              <td className="p-1">{i.code} <span className="text-xs text-secondary-500">{i.description} ({i.unit})</span></td>
              <td className="p-1 text-right font-mono">{i.received}</td>
              <td className="p-1 text-right font-mono">{i.issued}</td>
              <td className="p-1 text-right font-mono">{i.returned}</td>
              <td className="p-1 text-right font-mono">{i.damaged}</td>
              <td className="p-1 text-right font-mono font-semibold">{i.onHand}</td>
            </tr>
          ))}
          {data.items.length === 0 && <tr><td colSpan={6} className="p-1 text-secondary-500">No client-supplied items yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** The Power line tab (docs/construction/07): progress by section, wayleaves, crossings, the as-built register and client materials. */
export function PowerLineTab({ project: p }: TabProps) {
  const me = useConMe();
  const siteEdit = canOn(me, p.id, SITE_EDIT);
  const landEdit = canOn(me, p.id, LAND_EDIT);
  const matEdit = canOn(me, p.id, MAT_EDIT);
  const [o, setO] = useState<Overview | null>(null);
  const [cm, setCm] = useState<ClientMaterials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [sec, setSec] = useState({ code: "", name: "", fromKm: "", toKm: "", targetPoles: "", targetStays: "", targetConductorKm: "", targetTransformers: "", targetServices: "" });
  const [way, setWay] = useState({ landowner: "", phone: "", parcelNo: "", chainageKm: "", sectionId: "", status: "PENDING", compensation: "", agreedAt: "" });
  const [cross, setCross] = useState({ kind: "ROAD", authority: "", refNo: "", sectionId: "", status: "PENDING", approvedAt: "", expiresAt: "" });
  const [item, setItem] = useState({ code: "", description: "", unit: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setO(await apiGet<Overview>(`/construction/projects/${p.id}/power-line`));
      setCm(await apiGet<ClientMaterials>(`/construction/projects/${p.id}/client-materials`).catch(() => null));
      setError(null);
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load the power-line details."));
    }
  }, [p.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(send: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await send();
      after?.();
      await load();
    } catch (e) {
      setError(errorText(e, "That did not save."));
    } finally {
      setBusy(false);
    }
  }
  const upload = (kind: "wayleaves" | "crossings", id: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/jpeg,image/png,image/webp";
    input.onchange = () => input.files?.[0] && void run(() => conSend("POST", `/construction/projects/${p.id}/${kind}/${id}/file`, input.files![0]));
    input.click();
  };

  if (upgrade) return <UpgradeCard message={upgrade} />;
  if (!o) return <ErrorBox message={error} />;
  const sections = o.sections.map((s) => ({ id: s.id, code: s.code, name: s.name }));
  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <Panel title={`Progress${o.progress.percent !== null ? `: ${o.progress.percent}%` : ""}`}>
        <div className="grid gap-2 sm:grid-cols-5">
          {o.progress.measures.filter((m) => m.target > 0).map((m) => (
            <div key={m.measure} className="text-sm">
              <p className="text-xs text-secondary-500">{m.label}</p>
              <p className="font-semibold">{m.done} / {m.target}</p>
              <Bar percent={m.percent} />
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-3">
          {o.sections.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">{s.code} {s.name} {s.fromKm !== null && <span className="text-xs font-normal text-secondary-500">km {s.fromKm} to {s.toKm}</span>}</p>
                <span className="text-xs text-secondary-500">{s.percent !== null ? `${s.percent}%` : "no targets"}</span>
              </div>
              <Bar percent={s.percent} />
              <p className="mt-1 text-xs text-secondary-500">{s.measures.filter((m) => m.target > 0 || m.done > 0).map((m) => `${m.label}: ${m.done}/${m.target}`).join(" · ")}</p>
              {s.entries.length > 0 && <p className="text-xs text-secondary-500">Last: {s.entries[0].date}{s.entries[0].crew ? ` (${s.entries[0].crew})` : ""}</p>}
            </div>
          ))}
          {o.sections.length === 0 && <p className="text-sm text-secondary-500">Split the line into sections (e.g. km 0 to 5) to record progress by section.</p>}
        </div>
      </Panel>

      {siteEdit && sections.length > 0 && <Panel title="Record a day's progress"><ProgressForm projectId={p.id} sections={sections} onSaved={() => void load()} /></Panel>}

      {siteEdit && (
        <Panel title="Add a section">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Code"><input className={inputClass} value={sec.code} onChange={(e) => setSec({ ...sec, code: e.target.value })} placeholder="S1" /></Field>
            <Field label="Name"><input className={inputClass} value={sec.name} onChange={(e) => setSec({ ...sec, name: e.target.value })} placeholder="Rongo to Ogembo" /></Field>
            <Field label="From km"><input type="number" min={0} step="0.001" className={inputClass} value={sec.fromKm} onChange={(e) => setSec({ ...sec, fromKm: e.target.value })} /></Field>
            <Field label="To km"><input type="number" min={0} step="0.001" className={inputClass} value={sec.toKm} onChange={(e) => setSec({ ...sec, toKm: e.target.value })} /></Field>
            {MEASURES.map(([k, label]) => {
              const key = `target${k.charAt(0).toUpperCase()}${k.slice(1)}` as keyof typeof sec;
              return <Field key={k} label={`Target: ${label}`}><input type="number" min={0} step={k === "conductorKm" ? "0.001" : "1"} className={inputClass} value={sec[key]} onChange={(e) => setSec({ ...sec, [key]: e.target.value })} /></Field>;
            })}
          </div>
          <PrimaryButton disabled={busy || !sec.code.trim() || sec.name.trim().length < 2} onClick={() => void run(() => conSend("POST", `/construction/projects/${p.id}/sections`, { code: sec.code, name: sec.name, fromKm: n(sec.fromKm), toKm: n(sec.toKm), targetPoles: n(sec.targetPoles), targetStays: n(sec.targetStays), targetConductorKm: n(sec.targetConductorKm), targetTransformers: n(sec.targetTransformers), targetServices: n(sec.targetServices) }), () => setSec({ code: "", name: "", fromKm: "", toKm: "", targetPoles: "", targetStays: "", targetConductorKm: "", targetTransformers: "", targetServices: "" }))}>Add section</PrimaryButton>
        </Panel>
      )}

      <Panel title={`Wayleaves (${o.wayleaves.counts.agreed} of ${o.wayleaves.counts.total} agreed, ${o.wayleaves.counts.pending} pending${o.wayleaves.counts.refused ? `, ${o.wayleaves.counts.refused} refused` : ""} · compensation ${kes(o.wayleaves.compensation)})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-secondary-500"><tr><th className="p-1">Landowner</th><th className="p-1">Parcel</th><th className="p-1">Km</th><th className="p-1">Status</th><th className="p-1 text-right">Compensation</th><th className="p-1">Consent</th></tr></thead>
            <tbody>
              {o.wayleaves.rows.map((w) => (
                <tr key={w.id} className="border-t border-border">
                  <td className="p-1">{w.landowner}{w.phone && <span className="block text-xs text-secondary-500">{w.phone}</span>}</td>
                  <td className="p-1">{w.parcelNo ?? ""}{w.section && <span className="block text-xs text-secondary-500">{w.section}</span>}</td>
                  <td className="p-1">{w.chainageKm ?? ""}</td>
                  <td className="p-1">{w.status.toLowerCase()}{w.agreedAt && <span className="block text-xs text-secondary-500">{w.agreedAt}</span>}</td>
                  <td className="p-1 text-right font-mono">{w.compensation !== null ? kes(w.compensation) : ""}</td>
                  <td className="p-1 text-xs">
                    {w.hasFile && <button className="underline" onClick={() => void conOpenFile(`/construction/projects/${p.id}/wayleaves/${w.id}/file`)}>Open</button>}
                    {landEdit && <button className="ml-2 underline" onClick={() => upload("wayleaves", w.id)}>{w.hasFile ? "Replace" : "Upload"}</button>}
                  </td>
                </tr>
              ))}
              {o.wayleaves.rows.length === 0 && <tr><td colSpan={6} className="p-1 text-secondary-500">No wayleaves recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {landEdit && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Landowner"><input className={inputClass} value={way.landowner} onChange={(e) => setWay({ ...way, landowner: e.target.value })} /></Field>
              <Field label="Phone"><input className={inputClass} value={way.phone} onChange={(e) => setWay({ ...way, phone: e.target.value })} /></Field>
              <Field label="Parcel / plot no."><input className={inputClass} value={way.parcelNo} onChange={(e) => setWay({ ...way, parcelNo: e.target.value })} /></Field>
              <Field label="Chainage (km)"><input type="number" min={0} step="0.001" className={inputClass} value={way.chainageKm} onChange={(e) => setWay({ ...way, chainageKm: e.target.value })} /></Field>
              <Field label="Section">
                <select className={inputClass} value={way.sectionId} onChange={(e) => setWay({ ...way, sectionId: e.target.value })}><option value="">None</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select>
              </Field>
              <Field label="Status">
                <select className={inputClass} value={way.status} onChange={(e) => setWay({ ...way, status: e.target.value })}>{["PENDING", "AGREED", "REFUSED", "PAID"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
              </Field>
              <Field label="Compensation (KES)"><input type="number" min={0} className={inputClass} value={way.compensation} onChange={(e) => setWay({ ...way, compensation: e.target.value })} /></Field>
              <Field label="Agreed on"><input type="date" className={inputClass} value={way.agreedAt} onChange={(e) => setWay({ ...way, agreedAt: e.target.value })} /></Field>
            </div>
            <PrimaryButton disabled={busy || way.landowner.trim().length < 2} onClick={() => void run(() => conSend("POST", `/construction/projects/${p.id}/wayleaves`, { landowner: way.landowner, phone: way.phone || undefined, parcelNo: way.parcelNo || undefined, chainageKm: n(way.chainageKm), sectionId: way.sectionId || undefined, status: way.status, compensation: n(way.compensation), agreedAt: way.agreedAt || undefined }), () => setWay({ landowner: "", phone: "", parcelNo: "", chainageKm: "", sectionId: "", status: "PENDING", compensation: "", agreedAt: "" }))}>Add wayleave</PrimaryButton>
          </div>
        )}
      </Panel>

      <Panel title="Crossings (roads, railways, rivers, pipelines, other lines)">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-secondary-500"><tr><th className="p-1">Crossing</th><th className="p-1">Authority</th><th className="p-1">Ref</th><th className="p-1">Status</th><th className="p-1">Expires</th><th className="p-1">Approval</th></tr></thead>
            <tbody>
              {o.crossings.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-1">{c.kind.toLowerCase().replace("_", " ")}{c.section && <span className="block text-xs text-secondary-500">{c.section}</span>}</td>
                  <td className="p-1">{c.authority}</td>
                  <td className="p-1">{c.refNo ?? ""}</td>
                  <td className="p-1">{c.status.toLowerCase()}</td>
                  <td className={`p-1 ${c.state === "EXPIRED" ? "text-red-600" : c.state === "EXPIRING" ? "text-amber-600" : ""}`}>{c.expiresAt ?? ""}{c.daysLeft !== null && c.state !== "OK" && <span className="block text-xs">{c.daysLeft < 0 ? "expired" : `${c.daysLeft} days left`}</span>}</td>
                  <td className="p-1 text-xs">
                    {c.hasFile && <button className="underline" onClick={() => void conOpenFile(`/construction/projects/${p.id}/crossings/${c.id}/file`)}>Open</button>}
                    {landEdit && <button className="ml-2 underline" onClick={() => upload("crossings", c.id)}>{c.hasFile ? "Replace" : "Upload"}</button>}
                  </td>
                </tr>
              ))}
              {o.crossings.length === 0 && <tr><td colSpan={6} className="p-1 text-secondary-500">No crossings recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {landEdit && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Crossing">
                <select className={inputClass} value={cross.kind} onChange={(e) => setCross({ ...cross, kind: e.target.value })}>{["ROAD", "RAIL", "RIVER", "PIPELINE", "POWER_LINE", "OTHER"].map((k) => <option key={k} value={k}>{k.toLowerCase().replace("_", " ")}</option>)}</select>
              </Field>
              <Field label="Authority"><input className={inputClass} value={cross.authority} onChange={(e) => setCross({ ...cross, authority: e.target.value })} placeholder="KeNHA, KURA, KRC, WRA..." /></Field>
              <Field label="Reference"><input className={inputClass} value={cross.refNo} onChange={(e) => setCross({ ...cross, refNo: e.target.value })} /></Field>
              <Field label="Section">
                <select className={inputClass} value={cross.sectionId} onChange={(e) => setCross({ ...cross, sectionId: e.target.value })}><option value="">None</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select>
              </Field>
              <Field label="Status">
                <select className={inputClass} value={cross.status} onChange={(e) => setCross({ ...cross, status: e.target.value })}>{["PENDING", "APPROVED", "REJECTED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
              </Field>
              <Field label="Approved on"><input type="date" className={inputClass} value={cross.approvedAt} onChange={(e) => setCross({ ...cross, approvedAt: e.target.value })} /></Field>
              <Field label="Expires on"><input type="date" className={inputClass} value={cross.expiresAt} onChange={(e) => setCross({ ...cross, expiresAt: e.target.value })} /></Field>
            </div>
            <PrimaryButton disabled={busy || cross.authority.trim().length < 2} onClick={() => void run(() => conSend("POST", `/construction/projects/${p.id}/crossings`, { kind: cross.kind, authority: cross.authority, refNo: cross.refNo || undefined, sectionId: cross.sectionId || undefined, status: cross.status, approvedAt: cross.approvedAt || undefined, expiresAt: cross.expiresAt || undefined }), () => setCross({ kind: "ROAD", authority: "", refNo: "", sectionId: "", status: "PENDING", approvedAt: "", expiresAt: "" }))}>Add crossing</PrimaryButton>
          </div>
        )}
      </Panel>

      <Panel
        title={`As-built register (${o.assets.length})`}
        action={<button className="text-sm underline" onClick={() => csv(`${p.code}-as-built.csv`, [["Kind", "Number", "Section", "Specification", "Serial no.", "Latitude", "Longitude", "Installed", "Note"], ...o.assets.map((a) => [a.kind, a.tag, a.section, a.spec, a.serialNo, a.lat, a.lng, a.installedAt, a.note])])}>Download (CSV)</button>}
      >
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-secondary-500"><tr><th className="p-1">Kind</th><th className="p-1">Number</th><th className="p-1">Section</th><th className="p-1">Specification</th><th className="p-1">Position</th><th className="p-1">Installed</th></tr></thead>
            <tbody>
              {o.assets.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="p-1">{a.kind.toLowerCase()}</td>
                  <td className="p-1 font-mono">{a.tag}</td>
                  <td className="p-1">{a.section ?? ""}</td>
                  <td className="p-1">{a.spec ?? ""}{a.serialNo && <span className="block text-xs text-secondary-500">SN {a.serialNo}</span>}</td>
                  <td className="p-1 text-xs">{a.lat !== null ? <a href={`https://maps.google.com/?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer" className="underline">{a.lat}, {a.lng}</a> : ""}</td>
                  <td className="p-1">{a.installedAt ?? ""}</td>
                </tr>
              ))}
              {o.assets.length === 0 && <tr><td colSpan={6} className="p-1 text-secondary-500">Nothing recorded yet. Site staff record poles and transformers from Site, Line work on their phone.</td></tr>}
            </tbody>
          </table>
        </div>
        {siteEdit && <div className="mt-3"><AssetForm projectId={p.id} sections={sections} onSaved={() => void load()} /></div>}
      </Panel>

      {cm && (
        <Panel
          title="Client-supplied materials (free-issue)"
          action={<button className="text-sm underline" onClick={() => csv(`${p.code}-client-materials.csv`, [["Code", "Description", "Unit", "Received", "Issued", "Returned", "Damaged", "On hand"], ...cm.items.map((i) => [i.code, i.description, i.unit, i.received, i.issued, i.returned, i.damaged, i.onHand])])}>Download (CSV)</button>}
        >
          <p className="text-xs text-secondary-500">The client's property: kept apart from your own stock, never valued or costed.</p>
          <ClientItemsTable data={cm} />
          {matEdit && (
            <div className="mt-3 space-y-3">
              <ClientMoveForm projectId={p.id} data={cm} onSaved={() => void load()} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="New item code"><input className={inputClass} value={item.code} onChange={(e) => setItem({ ...item, code: e.target.value })} placeholder="POLE-11M" /></Field>
                <Field label="Description"><input className={inputClass} value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} /></Field>
                <Field label="Unit"><input className={inputClass} value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} placeholder="no, m, km" /></Field>
                <div className="flex items-end"><PrimaryButton disabled={busy || !item.code.trim() || item.description.trim().length < 2 || !item.unit.trim()} onClick={() => void run(() => conSend("POST", `/construction/projects/${p.id}/client-materials/items`, item), () => setItem({ code: "", description: "", unit: "" }))}>Add item</PrimaryButton></div>
              </div>
            </div>
          )}
          {cm.moves.length > 0 && (
            <div className="mt-3 text-xs text-secondary-500">
              <p className="font-semibold">Recent movements</p>
              {cm.moves.slice(0, 10).map((m) => (
                <p key={m.id}>
                  {m.moveDate} · {cm.items.find((i) => i.id === m.itemId)?.code} · {m.kind.toLowerCase()} {m.quantity}{m.section ? ` to ${m.section}` : ""}{m.reference ? ` · ${m.reference}` : ""}
                  {matEdit && <button className="ml-2 underline" onClick={() => window.confirm("Remove this movement?") && void run(() => conSend("DELETE", `/construction/projects/${p.id}/client-materials/moves/${m.id}`))}>remove</button>}
                </p>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
