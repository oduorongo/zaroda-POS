"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPut, ApiError } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { FARM_ROLES, SHAMBA_BRAND, SHAMBA_INK, type FarmStaff, type FarmUnit } from "../../../lib/shamba";

function Staff() {
  const [people, setPeople] = useState<FarmStaff[] | null>(null);
  const [units, setUnits] = useState<FarmUnit[]>([]);
  const [editing, setEditing] = useState<{ orgUserId: string; roles: string[]; unitIds: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [p, u] = await Promise.all([apiGet<FarmStaff[]>("/farm/staff"), apiGet<FarmUnit[]>("/farm/units")]);
      setPeople(p);
      setUnits(u.filter((x) => x.active));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load staff");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/farm/staff/${editing.orgUserId}/roles`, { roles: editing.roles, unitIds: editing.unitIds });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the roles");
    } finally {
      setBusy(false);
    }
  }

  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const flip = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>Staff and farm roles</h1>
      <p className="text-sm text-secondary-600">
        Add people under{" "}
        <Link href="/staff" className="underline">
          Staff
        </Link>{" "}
        in the back office, then give each their farm job here. People with a farm role count toward your plan&apos;s users; casual workers paid by
        the day never do. Only the farm owner can change roles.
      </p>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <Card title="Your team">
        {!people ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {people.map((p) => (
              <li key={p.orgUserId} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span>
                    <strong>{p.name}</strong> <span className="text-secondary-500">· {p.email}</span>
                    <span className="block text-xs text-secondary-600">
                      {p.farmRoles.length ? p.farmRoles.map((r) => FARM_ROLES[r] ?? r).join(", ") : "No farm role yet"}
                      {p.unitIds.length > 0 && ` · only ${p.unitIds.map((id) => unitName.get(id) ?? "?").join(", ")}`}
                    </span>
                  </span>
                  <button type="button" className="text-xs underline" onClick={() => setEditing({ orgUserId: p.orgUserId, roles: p.farmRoles, unitIds: p.unitIds })}>
                    Change
                  </button>
                </div>
                {editing?.orgUserId === p.orgUserId && (
                  <div className="mt-3 space-y-3 rounded-lg bg-background p-3">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(FARM_ROLES).map(([code, label]) => (
                        <label key={code} className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1">
                          <input type="checkbox" checked={editing.roles.includes(code)} onChange={(e) => setEditing({ ...editing, roles: flip(editing.roles, code, e.target.checked) })} />
                          {label}
                        </label>
                      ))}
                    </div>
                    {units.length > 0 && (
                      <div>
                        <p className="text-xs text-secondary-600">Only these parts of the farm (leave all unticked for the whole farm):</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {units.map((u) => (
                            <label key={u.id} className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1">
                              <input type="checkbox" checked={editing.unitIds.includes(u.id)} onChange={(e) => setEditing({ ...editing, unitIds: flip(editing.unitIds, u.id, e.target.checked) })} />
                              {u.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg px-3 py-1.5 font-semibold text-white disabled:opacity-50" style={{ background: SHAMBA_BRAND.navy }}>
                        {busy ? "Saving..." : "Save"}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-border px-3 py-1.5">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function ShambaStaffPage() {
  return <ShambaAppFrame>{() => <Staff />}</ShambaAppFrame>;
}
