"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { LAND_KINDS, SHAMBA_BRAND, UNIT_KINDS, inputClass, type FarmUnit } from "../../../lib/shamba";

const EMPTY = { kind: "FIELD", name: "", code: "", parentId: "", acres: "", capacity: "", notes: "" };

function Layout() {
  const [units, setUnits] = useState<FarmUnit[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => apiGet<FarmUnit[]>("/farm/units").then(setUnits, (e) => setError(e instanceof ApiError ? e.message : "Could not load the layout"));
  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/units", {
        kind: form.kind,
        name: form.name.trim(),
        ...(form.code.trim() ? { code: form.code.trim() } : {}),
        ...(form.parentId ? { parentId: form.parentId } : {}),
        ...(form.acres ? { acres: Number(form.acres) } : {}),
        ...(form.capacity ? { capacity: Number(form.capacity) } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      setForm({ ...EMPTY, kind: form.kind, parentId: form.parentId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add it");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(u: FarmUnit) {
    setError(null);
    try {
      await apiPatch(`/farm/units/${u.id}`, { active: !u.active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change it");
    }
  }

  const byId = new Map((units ?? []).map((u) => [u.id, u]));
  const land = (units ?? []).filter((u) => u.active && LAND_KINDS.includes(u.kind)).reduce((t, u) => t + Number(u.acres ?? 0), 0);
  const showAcres = ["BLOCK", "FIELD", "PADDOCK"].includes(form.kind);
  const showCapacity = ["PEN", "POULTRY_HOUSE", "POND", "APIARY", "PADDOCK"].includes(form.kind);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Farm layout</h1>
      <p className="text-sm text-secondary-600">The parts of your farm. Fields and paddocks count toward your plan&apos;s acres ({land.toLocaleString("en-KE")} acres now).</p>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <Card title="Add a part of the farm">
        <form onSubmit={add} className="grid gap-3 text-sm sm:grid-cols-3">
          <label>
            Kind
            <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(UNIT_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Field 3, Cow shed A" required />
          </label>
          <label>
            Inside (optional)
            <select className={inputClass} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">- Not inside another part -</option>
              {(units ?? [])
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({UNIT_KINDS[u.kind] ?? u.kind})
                  </option>
                ))}
            </select>
          </label>
          {showAcres && (
            <label>
              Acres
              <input type="number" step="0.001" min={0} className={inputClass} value={form.acres} onChange={(e) => setForm({ ...form, acres: e.target.value })} />
            </label>
          )}
          {showCapacity && (
            <label>
              Holds (animals / birds)
              <input type="number" min={0} className={inputClass} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
            </label>
          )}
          <label>
            Code (optional)
            <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. F3" />
          </label>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy || !form.name.trim()} className="rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-50" style={{ background: SHAMBA_BRAND.orange }}>
              {busy ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      </Card>

      <Card title="Your farm">
        {!units ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : units.length === 0 ? (
          <p className="text-sm text-secondary-500">Nothing yet. Start with your blocks and fields, then sheds, pens and poultry houses.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-secondary-500">
                <tr>
                  <th className="p-2">Name</th>
                  <th className="p-2">Kind</th>
                  <th className="p-2">Inside</th>
                  <th className="p-2 text-right">Acres</th>
                  <th className="p-2 text-right">Holds</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id} className={`border-t border-secondary-100 ${u.active ? "" : "text-secondary-400"}`}>
                    <td className="p-2 font-medium">
                      {u.name}
                      {u.code && <span className="text-xs text-secondary-500"> ({u.code})</span>}
                    </td>
                    <td className="p-2">{UNIT_KINDS[u.kind] ?? u.kind}</td>
                    <td className="p-2">{u.parentId ? byId.get(u.parentId)?.name ?? "-" : "-"}</td>
                    <td className="p-2 text-right">{u.acres ? Number(u.acres).toLocaleString("en-KE") : ""}</td>
                    <td className="p-2 text-right">{u.capacity ?? ""}</td>
                    <td className="p-2 text-right">
                      <button type="button" className="text-xs underline" onClick={() => void toggle(u)}>
                        {u.active ? "Stop using" : "Use again"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ShambaLayoutPage() {
  return <ShambaAppFrame>{() => <Layout />}</ShambaAppFrame>;
}
