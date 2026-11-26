"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { ENTERPRISE_KINDS, SHAMBA_BRAND, SHAMBA_INK, inputClass, type FarmEnterprise, type FarmUnit } from "../../../lib/shamba";

function Enterprises() {
  const [list, setList] = useState<FarmEnterprise[] | null>(null);
  const [units, setUnits] = useState<FarmUnit[]>([]);
  const [form, setForm] = useState({ kind: "DAIRY", name: "", unitIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [e, u] = await Promise.all([apiGet<FarmEnterprise[]>("/farm/enterprises"), apiGet<FarmUnit[]>("/farm/units")]);
      setList(e);
      setUnits(u.filter((x) => x.active));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load enterprises");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/enterprises", { kind: form.kind, name: form.name.trim(), unitIds: form.unitIds });
      setForm({ kind: form.kind, name: "", unitIds: [] });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add it");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(x: FarmEnterprise) {
    try {
      await apiPatch(`/farm/enterprises/${x.id}`, { active: !x.active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change it");
    }
  }

  const unitName = new Map(units.map((u) => [u.id, u.name]));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>Enterprises</h1>
      <p className="text-sm text-secondary-600">Each line of business on your farm. Costs and income are tagged to one, so you can see which makes money.</p>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <Card title="Add an enterprise">
        <form onSubmit={add} className="grid gap-3 text-sm sm:grid-cols-2">
          <label>
            Kind
            <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(ENTERPRISE_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dairy herd, Layers house 1, Maize long rains" required />
          </label>
          {units.length > 0 && (
            <fieldset className="sm:col-span-2">
              <legend>Parts of the farm it uses</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {units.map((u) => (
                  <label key={u.id} className="flex items-center gap-1 rounded-full border border-border px-2 py-1">
                    <input
                      type="checkbox"
                      checked={form.unitIds.includes(u.id)}
                      onChange={(e) => setForm({ ...form, unitIds: e.target.checked ? [...form.unitIds, u.id] : form.unitIds.filter((id) => id !== u.id) })}
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy || form.name.trim().length < 2} className="rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-50" style={{ background: SHAMBA_BRAND.orange }}>
              {busy ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      </Card>

      <Card title="Your enterprises">
        {!list ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-secondary-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {list.map((x) => (
              <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${x.active ? "" : "text-secondary-400"}`}>
                <span>
                  <strong>{x.name}</strong> <span className="text-secondary-500">· {ENTERPRISE_KINDS[x.kind] ?? x.kind}</span>
                  {x.unitIds.length > 0 && <span className="block text-xs text-secondary-500">{x.unitIds.map((id) => unitName.get(id) ?? "?").join(", ")}</span>}
                </span>
                <button type="button" className="text-xs underline" onClick={() => void toggle(x)}>
                  {x.active ? "Stop" : "Restart"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function ShambaEnterprisesPage() {
  return <ShambaAppFrame>{() => <Enterprises />}</ShambaAppFrame>;
}
