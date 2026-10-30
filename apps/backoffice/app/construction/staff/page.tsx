"use client";

import { useCallback, useEffect, useState } from "react";
import { PasswordInput } from "@zaroda/ui";
import { apiGet, apiPost, apiPut } from "../../../lib/api";
import { CON_BRAND, errorText } from "../../../lib/construction";
import { ConShell } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../components/construction/ui";

interface Staff { orgUserId: string; fullName: string; email: string; coreRole: string; isActive: boolean; roles: string[]; projectRoles: { projectId: string; role: string }[] }
interface RoleRow { code: string; name: string; scope: string }

const ACCESS: Record<string, string> = { OWNER: "Director (full access)", MANAGER: "Office", SUPERVISOR: "Site", AUDITOR: "View only" };
const SITE = { code: "SITE", name: "Site staff (engineer, supervisor, storekeeper, timekeeper - roles given per project)" };
const blank = { fullName: "", email: "", password: "", job: "CON_QS" };

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([apiGet<Staff[]>("/construction/staff"), apiGet<RoleRow[]>("/construction/roles")]);
      setStaff(s);
      setRoles(r.filter((x) => x.scope === "COMPANY"));
    } catch (e) {
      setError(errorText(e, "Could not load staff."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setAdding(true);
    setError(null);
    try {
      await apiPost("/construction/staff", { ...form, fullName: form.fullName.trim() || undefined, password: form.password || undefined });
      setForm(blank);
      await load();
    } catch (e) {
      setError(errorText(e, "Could not add this person."));
    } finally {
      setAdding(false);
    }
  }

  async function toggle(s: Staff, code: string) {
    const next = s.roles.includes(code) ? s.roles.filter((r) => r !== code) : [...s.roles, code];
    setSaving(s.orgUserId);
    try {
      await apiPut(`/construction/staff/${s.orgUserId}/roles`, { roles: next });
      await load();
      setError(null);
    } catch (e) {
      setError(errorText(e, "Could not save roles."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <ConShell title="Staff & roles">
      <ErrorBox message={error} />
      <Panel title="Add a person">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name"><input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="Email"><input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Password (at least 8 characters)"><PasswordInput className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Job">
            <select className={inputClass} value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })}>
              {[...roles, SITE].map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="mt-2 text-xs text-secondary-500">Each person counts toward your plan&apos;s user limit. If the email already has a Zaroda account, its existing password is kept.</p>
        <div className="mt-3"><PrimaryButton disabled={adding || !form.email.trim()} onClick={add}>{adding ? "Adding..." : "Add person"}</PrimaryButton></div>
      </Panel>
      <div className="space-y-3">
        {staff.map((s) => (
          <Panel key={s.orgUserId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-semibold">{s.fullName}{!s.isActive && " (inactive)"}</p>
                <p className="text-xs text-secondary-500">{s.email} · {ACCESS[s.coreRole] ?? s.coreRole}</p>
              </div>
              {saving === s.orgUserId && <span className="text-xs text-secondary-500">Saving...</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {roles.map((r) => {
                const on = s.roles.includes(r.code);
                return (
                  <button
                    key={r.code}
                    type="button"
                    disabled={saving === s.orgUserId}
                    onClick={() => toggle(s, r.code)}
                    className="rounded-full border px-3 py-1.5 text-xs font-medium"
                    style={on ? { background: CON_BRAND.navy, borderColor: CON_BRAND.navy, color: "white" } : { borderColor: "#cbd5e1" }}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
            {s.coreRole === "OWNER" && <p className="mt-2 text-xs text-secondary-500">Owners always act as Director.</p>}
          </Panel>
        ))}
      </div>
    </ConShell>
  );
}
