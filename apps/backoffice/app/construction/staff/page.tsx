"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPut } from "../../../lib/api";
import { CON_BRAND, errorText } from "../../../lib/construction";
import { ConShell } from "../../../components/construction/con-shell";
import { ErrorBox, Panel } from "../../../components/construction/ui";

interface Staff { orgUserId: string; fullName: string; email: string; coreRole: string; isActive: boolean; roles: string[]; projectRoles: { projectId: string; role: string }[] }
interface RoleRow { code: string; name: string; scope: string }

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

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
      <p className="text-sm text-secondary-600">
        Add people from <Link href="/staff" style={{ color: CON_BRAND.orange }}>Staff</Link> first (they count toward your plan&apos;s user limit), then give them their construction roles here. Project roles are given on each project.
      </p>
      <div className="space-y-3">
        {staff.map((s) => (
          <Panel key={s.orgUserId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-semibold">{s.fullName}{!s.isActive && " (inactive)"}</p>
                <p className="text-xs text-secondary-500">{s.email} · {s.coreRole}</p>
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
