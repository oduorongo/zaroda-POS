"use client";

import { useCallback, useEffect, useState } from "react";
import { getSession } from "../../../lib/auth";
import { apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import { CON_BRAND, errorText, isDirector, kes } from "../../../lib/construction";
import { ConShell, useConMe } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../components/construction/ui";

interface Office { id: string; name: string; county: string | null; projects: number; staff: number }
interface CustomRole { id: string; name: string; grants: string[]; grantNames: string[]; approvalLimit: number | null; holders: number }
interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; requests: number; revokedAt: string | null; createdAt: string }
interface Staff { orgUserId: string; fullName: string; email: string; officeId: string | null; customRoleIds: string[] }
interface Project { id: string; code: string; name: string; officeId: string | null }
interface RoleRow { code: string; name: string; scope: string }

const SCOPES = [
  { code: "projects", name: "Projects" },
  { code: "ipcs", name: "Certified IPCs" },
  { code: "reports", name: "Reports" },
];

export default function EnterprisePage() {
  return (
    <ConShell title="Offices, roles & API">
      <Enterprise />
    </ConShell>
  );
}

function Enterprise() {
  const me = useConMe();
  if (!me) return null;
  if (!isDirector(me)) return <ErrorBox message="Only the Director manages offices, custom roles and API keys." />;
  const f = me.plan.features;
  return (
    <div className="space-y-4">
      {f.includes("multi_branch") ? <Offices /> : <UpgradeCard message="Branch offices are on the Enterprise plan." />}
      {f.includes("custom_roles") ? <CustomRoles /> : <UpgradeCard message="Custom roles are on the Enterprise plan." />}
      {f.includes("api") ? <ApiKeys /> : <UpgradeCard message="API access is on the Enterprise plan." />}
    </div>
  );
}

function useLoad<T>(path: string, fallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => apiGet<T>(path).then(setData).then(() => setError(null)).catch((e) => setError(errorText(e, fallback))), [path, fallback]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = (fn: () => Promise<unknown>) => fn().then(load).catch((e) => setError(errorText(e, "That did not work.")));
  return { data, error, setError, load, act };
}

function Offices() {
  const { data: offices, error, act } = useLoad<Office[]>("/construction/offices", "Could not load offices.");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState({ name: "", county: "" });

  const loadLinks = useCallback(() => Promise.all([apiGet<Staff[]>("/construction/staff").then(setStaff), apiGet<Project[]>("/construction/projects").then(setProjects)]).catch(() => undefined), []);
  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);
  const link = (fn: () => Promise<unknown>) => act(fn).then(loadLinks);

  const select = (value: string | null, onChange: (id: string | null) => void) => (
    <select className={`${inputClass} max-w-[14rem]`} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Head office (all)</option>
      {offices?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );

  return (
    <Panel title="Branch offices">
      <ErrorBox message={error} />
      <p className="mb-3 text-xs text-secondary-500">Office staff see only their office&apos;s projects; head-office staff see all. New projects belong to the office of whoever creates them.</p>
      <ul className="divide-y divide-border text-sm">
        {offices?.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><strong>{o.name}</strong>{o.county && ` · ${o.county}`} <span className="text-xs text-secondary-500">({o.projects} projects, {o.staff} staff)</span></span>
            <span className="flex gap-3 text-xs">
              <button type="button" className="underline" onClick={() => { const name = prompt("Office name", o.name); if (name?.trim()) void act(() => apiPut(`/construction/offices/${o.id}`, { name, county: o.county ?? undefined })); }}>Rename</button>
              <button type="button" className="underline text-red-700" onClick={() => confirm(`Remove ${o.name}? Its projects and staff go back to head office.`) && link(() => apiDelete(`/construction/offices/${o.id}`))}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Field label="New office"><input className={inputClass} value={form.name} placeholder="Kisumu office" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="County"><input className={inputClass} value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })} /></Field>
        <div className="flex items-end"><PrimaryButton disabled={form.name.trim().length < 2} onClick={() => act(() => apiPost("/construction/offices", { name: form.name, county: form.county || undefined })).then(() => setForm({ name: "", county: "" }))}>Add office</PrimaryButton></div>
      </div>

      {!!offices?.length && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section>
            <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--con-ink)" }}>Staff</h3>
            {staff.map((s) => (
              <div key={s.orgUserId} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="min-w-0 truncate">{s.fullName}</span>
                {select(s.officeId, (officeId) => link(() => apiPut(`/construction/staff/${s.orgUserId}/office`, { officeId })))}
              </div>
            ))}
          </section>
          <section>
            <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--con-ink)" }}>Projects</h3>
            {projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="min-w-0 truncate">{p.code} · {p.name}</span>
                {select(p.officeId, (officeId) => link(() => apiPut(`/construction/projects/${p.id}/office`, { officeId })))}
              </div>
            ))}
          </section>
        </div>
      )}
    </Panel>
  );
}

function CustomRoles() {
  const { data: roles, error, act } = useLoad<CustomRole[]>("/construction/custom-roles", "Could not load custom roles.");
  const [jobs, setJobs] = useState<RoleRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [form, setForm] = useState({ name: "", grants: [] as string[], limit: "" });

  const loadStaff = useCallback(() => apiGet<Staff[]>("/construction/staff").then(setStaff).catch(() => undefined), []);
  useEffect(() => {
    apiGet<RoleRow[]>("/construction/roles").then((r) => setJobs(r.filter((x) => x.scope === "COMPANY" && x.code !== "CON_DIRECTOR"))).catch(() => undefined);
    void loadStaff();
  }, [loadStaff]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = () =>
    act(() => apiPost("/construction/custom-roles", { name: form.name, grants: form.grants, approvalLimit: form.limit.trim() ? Number(form.limit.replace(/,/g, "")) : undefined })).then(() => setForm({ name: "", grants: [], limit: "" }));

  return (
    <Panel title="Custom roles">
      <ErrorBox message={error} />
      <p className="mb-3 text-xs text-secondary-500">A custom role acts as the jobs you tick, with its own approval limit if you set one. Give it to people on top of their usual jobs.</p>
      <ul className="divide-y divide-border text-sm">
        {roles?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><strong>{r.name}</strong> · {r.grantNames.join(", ")} · approves up to {kes(r.approvalLimit)} <span className="text-xs text-secondary-500">({r.holders} people)</span></span>
            <button type="button" className="text-xs underline text-red-700" onClick={() => confirm(`Delete the role ${r.name}?`) && act(() => apiDelete(`/construction/custom-roles/${r.id}`)).then(loadStaff)}>Delete</button>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Role name"><input className={inputClass} value={form.name} placeholder="Regional Manager" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Approval limit (KES, empty = the jobs' own)"><input className={inputClass} inputMode="decimal" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {jobs.map((j) => (
            <Chip key={j.code} on={form.grants.includes(j.code)} onClick={() => setForm({ ...form, grants: toggle(form.grants, j.code) })}>{j.name}</Chip>
          ))}
        </div>
        <PrimaryButton disabled={form.name.trim().length < 2 || !form.grants.length} onClick={save}>Add role</PrimaryButton>
      </div>

      {!!roles?.length && (
        <section className="mt-4">
          <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--con-ink)" }}>Who holds them</h3>
          {staff.map((s) => (
            <div key={s.orgUserId} className="flex flex-wrap items-center gap-2 py-1 text-sm">
              <span className="w-40 truncate">{s.fullName}</span>
              {roles.map((r) => (
                <Chip key={r.id} on={s.customRoleIds.includes(r.id)} onClick={() => act(() => apiPut(`/construction/staff/${s.orgUserId}/custom-roles`, { customRoleIds: toggle(s.customRoleIds, r.id) })).then(loadStaff)}>{r.name}</Chip>
              ))}
            </div>
          ))}
        </section>
      )}
    </Panel>
  );
}

function ApiKeys() {
  const { data: keys, error, setError, act } = useLoad<ApiKey[]>("/construction/api-keys", "Could not load API keys.");
  const [form, setForm] = useState({ name: "", scopes: ["projects"] as string[] });
  const [created, setCreated] = useState<string | null>(null);
  const base = `${(getSession()?.apiBaseUrl ?? "").replace(/\/+$/, "")}/construction-api/v1`;

  async function create() {
    try {
      const r = await apiPost<{ key: string }>("/construction/api-keys", form);
      setCreated(r.key);
      setForm({ name: "", scopes: ["projects"] });
      await act(async () => undefined);
    } catch (e) {
      setError(errorText(e, "Could not create the key."));
    }
  }

  return (
    <Panel title="API keys (read-only)">
      <ErrorBox message={error} />
      <p className="mb-3 text-xs text-secondary-500">
        For your own systems (ERP, Power BI). Send <code>Authorization: Bearer &lt;key&gt;</code> to <code className="break-all">{base}</code> - <code>/projects</code>, <code>/projects/:id</code>, <code>/projects/:id/ipcs</code>, <code>/reports/:key</code>. 60 requests a minute. Keys can only read.
      </p>
      {created && (
        <div className="mb-3 rounded-lg border-2 p-3 text-sm" style={{ borderColor: CON_BRAND.gold }}>
          <p className="font-semibold">Copy this key now - it is never shown again.</p>
          <code className="mt-1 block break-all">{created}</code>
          <button type="button" className="mt-2 text-xs underline" onClick={() => void navigator.clipboard?.writeText(created)}>Copy</button>
        </div>
      )}
      <ul className="divide-y divide-border text-sm">
        {keys?.map((k) => (
          <li key={k.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${k.revokedAt ? "text-secondary-500" : ""}`}>
            <span>
              <strong>{k.name}</strong> · zcon_{k.prefix}_… · {k.scopes.join(", ")}
              <span className="block text-xs text-secondary-500">{k.requests} requests{k.lastUsedAt ? `, last ${new Date(k.lastUsedAt).toLocaleString("en-KE")}` : ""}{k.revokedAt ? ` · revoked ${new Date(k.revokedAt).toLocaleDateString("en-KE")}` : ""}</span>
            </span>
            {!k.revokedAt && <button type="button" className="text-xs underline text-red-700" onClick={() => confirm(`Revoke ${k.name}? Anything using it stops working.`) && act(() => apiDelete(`/construction/api-keys/${k.id}`))}>Revoke</button>}
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-2">
        <Field label="Key name"><input className={`${inputClass} max-w-sm`} value={form.name} placeholder="Power BI" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <Chip key={s.code} on={form.scopes.includes(s.code)} onClick={() => setForm({ ...form, scopes: form.scopes.includes(s.code) ? form.scopes.filter((x) => x !== s.code) : [...form.scopes, s.code] })}>{s.name}</Chip>
          ))}
        </div>
        <PrimaryButton disabled={form.name.trim().length < 2 || !form.scopes.length} onClick={create}>Create key</PrimaryButton>
      </div>
    </Panel>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border px-3 py-1.5 text-xs font-medium" style={on ? { background: CON_BRAND.navy, borderColor: CON_BRAND.navy, color: "white" } : { borderColor: "#cbd5e1" }}>
      {children}
    </button>
  );
}
