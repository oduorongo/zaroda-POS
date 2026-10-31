"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isDirector, isUpgrade, kes } from "../../../lib/construction";
import { ConShell, useConMe } from "../../../components/construction/con-shell";
import { ErrorBox, ExpiryBadge, Field, Panel, PrimaryButton, UpgradeCard, inputClass, type ExpiryState } from "../../../components/construction/ui";

interface Worker { id: string; name: string; idNo: string | null; phone: string | null; trade: string; ncaCardNo: string | null; ncaExpiresAt: string | null; ncaState: ExpiryState | null; dailyRate: number; isSupervisor: boolean; isActive: boolean; project: { id: string; code: string; name: string } | null }
interface Project { id: string; code: string; name: string; status: string }

const TRADES = ["Mason", "Carpenter", "Steel fixer", "Plumber", "Electrician", "Painter", "Welder", "Foreman", "Helper", "Store helper", "Driver", "Watchman"];
const blank = { name: "", idNo: "", phone: "", trade: "Mason", ncaCardNo: "", ncaExpiresAt: "", dailyRate: "", isSupervisor: false, projectId: "" };

/** The worker register. Lists mask ID numbers and phones; opening a worker shows them in full only to Director, Accounts and Compliance. */
export default function WorkersPage() {
  return (
    <ConShell title="Workers">
      <Workers />
    </ConShell>
  );
}

function Workers() {
  const me = useConMe();
  const siteProjects = useMemo(() => new Set(me?.projectRoles.filter((r) => ["CON_PROJECT_MGR", "CON_SITE_SUPERVISOR", "CON_TIMEKEEPER"].includes(r.role)).map((r) => r.projectId)), [me]);
  const canAdd = isDirector(me) || siteProjects.size > 0;
  const fullId = hasConRole(me, "CON_ACCOUNTANT", "CON_COMPLIANCE");
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setWorkers(await apiGet<Worker[]>(`/construction/workers${filter ? `?projectId=${filter}` : ""}`));
      setProjects((await apiGet<Project[]>("/construction/projects").catch(() => [])).filter((p) => p.status !== "CLOSED"));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load workers."));
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = workers.filter((w) => !search.trim() || `${w.name} ${w.trade}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pickable = projects.filter((p) => isDirector(me) || hasConRole(me, "CON_CONTRACTS_MGR") || siteProjects.has(p.id));

  async function edit(w: Worker) {
    try {
      const full = await apiGet<Worker>(`/construction/workers/${w.id}`);
      setEditing(w.id);
      setForm({ name: full.name, idNo: full.idNo ?? "", phone: full.phone ?? "", trade: full.trade, ncaCardNo: full.ncaCardNo ?? "", ncaExpiresAt: full.ncaExpiresAt ?? "", dailyRate: String(full.dailyRate), isSupervisor: full.isSupervisor, projectId: full.project?.id ?? "" });
      setOpen(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(errorText(e, "Could not open the worker."));
    }
  }

  async function save(isActive?: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const masked = (v: string) => v.includes("*");
      const body = {
        name: form.name, trade: form.trade, dailyRate: Number(form.dailyRate), isSupervisor: form.isSupervisor, projectId: form.projectId || undefined,
        idNo: form.idNo && !masked(form.idNo) ? form.idNo : undefined, phone: form.phone && !masked(form.phone) ? form.phone : undefined,
        ncaCardNo: form.ncaCardNo || undefined, ncaExpiresAt: form.ncaExpiresAt || undefined, ...(isActive === undefined ? {} : { isActive }),
      };
      const r = await conSend<{ warning?: string | null }>(editing ? "PUT" : "POST", `/construction/workers${editing ? `/${editing}` : ""}`, body);
      setNotice(r.warning ?? (editing ? "Worker saved." : "Worker added."));
      setForm(blank);
      setEditing(null);
      setOpen(false);
      await load();
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not save the worker."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ErrorBox message={error} />
      {upgrade && <UpgradeCard message={upgrade} />}
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      {canAdd && !open && <PrimaryButton onClick={() => (setForm({ ...blank, projectId: pickable[0]?.id ?? "" }), setEditing(null), setOpen(true))}>Add a worker</PrimaryButton>}

      {open && (
        <Panel title={editing ? "Edit worker" : "Add a worker"}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><input className={`${inputClass} text-base`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Trade">
              <select className={`${inputClass} text-base`} value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })}>
                {Array.from(new Set([...TRADES, form.trade])).map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="ID number"><input className={`${inputClass} text-base`} value={form.idNo} placeholder={editing && !fullId ? "Hidden - type to replace" : ""} onChange={(e) => setForm({ ...form, idNo: e.target.value })} /></Field>
            <Field label="Phone (M-Pesa)"><input className={`${inputClass} text-base`} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Daily rate (KES)"><input className={`${inputClass} text-base`} inputMode="decimal" value={form.dailyRate} onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} /></Field>
            <Field label="Project">
              <select className={`${inputClass} text-base`} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                {(isDirector(me) || hasConRole(me, "CON_CONTRACTS_MGR")) && <option value="">Not on a project</option>}
                {pickable.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select>
            </Field>
            <Field label="NCA accreditation card no."><input className={`${inputClass} text-base`} value={form.ncaCardNo} onChange={(e) => setForm({ ...form, ncaCardNo: e.target.value })} /></Field>
            <Field label="Card expires"><input type="date" className={`${inputClass} text-base`} value={form.ncaExpiresAt} onChange={(e) => setForm({ ...form, ncaExpiresAt: e.target.value })} /></Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={form.isSupervisor} onChange={(e) => setForm({ ...form, isSupervisor: e.target.checked })} /> Site supervisor / foreman (needs a valid NCA card)</label>
          <p className="mt-2 text-xs text-secondary-500">ID numbers and phones are personal data: lists show only the last digits.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <PrimaryButton disabled={busy || form.name.trim().length < 2 || !form.dailyRate} onClick={() => save()}>{busy ? "Saving..." : editing ? "Save" : "Add worker"}</PrimaryButton>
            {editing && <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => save(!workers.find((w) => w.id === editing)?.isActive)}>{workers.find((w) => w.id === editing)?.isActive ? "Mark as left" : "Bring back"}</button>}
            <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => (setOpen(false), setEditing(null), setForm(blank))}>Cancel</button>
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap gap-2">
        <input className={`${inputClass} flex-1 text-base`} placeholder="Search name or trade" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={`${inputClass} w-auto text-base`} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
      </div>

      <p className="text-sm text-secondary-600">{workers.filter((w) => w.isActive).length} active workers{workers.some((w) => w.ncaState === "EXPIRED" && w.isActive) && <span className="ml-1 font-semibold text-red-700">· {workers.filter((w) => w.ncaState === "EXPIRED" && w.isActive).length} with expired NCA cards</span>}</p>
      <ul className="space-y-2">
        {shown.map((w) => (
          <li key={w.id} className={`rounded-xl border bg-surface p-3 ${w.ncaState === "EXPIRED" && w.isActive ? "border-red-400" : "border-border"} ${w.isActive ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{w.name}{w.isSupervisor && <span className="ml-1 text-xs" style={{ color: CON_BRAND.orange }}>Foreman</span>}{!w.isActive && " (left)"}</p>
                <p className="text-xs text-secondary-500">{w.trade} · {kes(w.dailyRate)}/day{w.project ? ` · ${w.project.code}` : ""}</p>
                <p className="text-xs text-secondary-500">ID {w.idNo ?? "-"} · {w.phone ?? "no phone"}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {w.ncaExpiresAt ? <ExpiryBadge state={w.ncaState ?? "NO_EXPIRY"} /> : <span className="text-[11px] text-secondary-500">No NCA card</span>}
                {(isDirector(me) || (w.project && siteProjects.has(w.project.id))) && <button type="button" className="text-xs underline" onClick={() => edit(w)}>Edit</button>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
