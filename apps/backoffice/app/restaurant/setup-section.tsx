"use client";

import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from "../../lib/api";

interface Table {
  id: string;
  label: string;
  seats: number;
}
interface Station {
  id: string;
  name: string;
}
interface Dish {
  variantId: string;
  name: string;
  sku: string;
  price: number;
  onlineVisible: boolean;
  hasRecipe: boolean;
  stationId: string | null;
}

const input = "rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/**
 * What a restaurant sets up once: its tables, its kitchen stations, and which station prepares each dish. Table QR
 * ordering needs at least one station (a paid order must always have a kitchen screen to land on) and dishes marked
 * "show online" under Products.
 */
export function SetupSection({ branchId, tables, stations, onChanged }: { branchId: string; tables: Table[]; stations: Station[]; onChanged: () => void }) {
  const [tableForm, setTableForm] = useState({ label: "", seats: "4" });
  const [stationName, setStationName] = useState("");
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editTable, setEditTable] = useState<{ id: string; label: string; seats: string } | null>(null);
  const [editStation, setEditStation] = useState<{ id: string; name: string } | null>(null);
  const [lead, setLead] = useState("60");

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);
  const loadDishes = () => apiGet<Dish[]>("/restaurant/dishes").then(setDishes).catch((err) => fail(err, "Could not load your dishes."));
  useEffect(() => {
    void loadDishes();
  }, []);
  useEffect(() => {
    apiGet<{ reserveLeadMinutes: number }>(`/restaurant/settings?branchId=${branchId}`)
      .then((r) => setLead(String(r.reserveLeadMinutes)))
      .catch(() => undefined);
  }, [branchId]);

  async function saveTable(e: React.FormEvent) {
    e.preventDefault();
    if (!editTable) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPatch(`/restaurant/tables/${editTable.id}`, { label: editTable.label.trim(), seats: Number(editTable.seats) });
      setNotice("Table updated.");
      setEditTable(null);
      onChanged();
    } catch (err) {
      fail(err, "Could not change the table.");
    } finally {
      setBusy(false);
    }
  }

  async function removeTable(t: Table) {
    if (!window.confirm(`Remove ${t.label}? If it has been used it is kept in your history but taken off the floor.`)) return;
    setError(null);
    setNotice(null);
    try {
      const r = await apiDelete<{ archived: boolean }>(`/restaurant/tables/${t.id}`);
      setNotice(r.archived ? `${t.label} was taken off the floor (it has history, so it is kept in your records).` : `${t.label} was deleted.`);
      onChanged();
    } catch (err) {
      fail(err, "Could not remove the table.");
    }
  }

  async function saveStation(e: React.FormEvent) {
    e.preventDefault();
    if (!editStation) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPatch(`/restaurant/stations/${editStation.id}`, { name: editStation.name.trim() });
      setNotice("Station renamed.");
      setEditStation(null);
      onChanged();
    } catch (err) {
      fail(err, "Could not rename the station.");
    } finally {
      setBusy(false);
    }
  }

  async function removeStation(st: Station) {
    if (!window.confirm(`Remove the ${st.name} station? Dishes sent there will go to your first station.`)) return;
    setError(null);
    setNotice(null);
    try {
      const r = await apiDelete<{ archived: boolean }>(`/restaurant/stations/${st.id}`);
      setNotice(r.archived ? `${st.name} was taken off (it has history, so it is kept in your records).` : `${st.name} was deleted.`);
      onChanged();
      void loadDishes();
    } catch (err) {
      fail(err, "Could not remove the station.");
    }
  }

  async function saveLead(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut("/restaurant/settings", { branchId, reserveLeadMinutes: Math.max(0, Math.round(Number(lead) || 0)) });
      setNotice("Saved.");
    } catch (err) {
      fail(err, "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function addTable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPost("/restaurant/tables", { branchId, label: tableForm.label.trim(), seats: Number(tableForm.seats) });
      setNotice(`${tableForm.label.trim()} added.`);
      setTableForm({ label: "", seats: tableForm.seats });
      onChanged();
    } catch (err) {
      fail(err, "Could not add the table.");
    } finally {
      setBusy(false);
    }
  }

  async function addStation(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPost("/restaurant/stations", { branchId, name: stationName.trim() });
      setNotice(`${stationName.trim()} added.`);
      setStationName("");
      onChanged();
    } catch (err) {
      fail(err, "Could not add the station.");
    } finally {
      setBusy(false);
    }
  }

  async function setStation(dish: Dish, stationId: string) {
    setError(null);
    try {
      await apiPut(`/restaurant/dishes/${dish.variantId}/station`, { stationId: stationId || null });
      setDishes((cur) => cur && cur.map((d) => (d.variantId === dish.variantId ? { ...d, stationId: stationId || null } : d)));
    } catch (err) {
      fail(err, "Could not save that.");
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Tables</h2>
          <p className="text-xs text-secondary-500">Name each table the way your staff and customers call it (Table 4, Patio 2).</p>
          <form onSubmit={addTable} className="flex flex-wrap gap-2">
            <input className={`${input} min-w-0 flex-1`} required maxLength={50} placeholder="Table name" value={tableForm.label} onChange={(e) => setTableForm({ ...tableForm, label: e.target.value })} />
            <input className={`${input} w-20`} required type="number" min={1} max={100} aria-label="Seats" value={tableForm.seats} onChange={(e) => setTableForm({ ...tableForm, seats: e.target.value })} />
            <button className={button} disabled={busy}>
              Add table
            </button>
          </form>
          {tables.length === 0 && <p className="text-xs text-secondary-500">No tables yet.</p>}
          <ul className="divide-y divide-border text-sm">
            {tables.map((t) =>
              editTable?.id === t.id ? (
                <li key={t.id} className="py-2">
                  <form onSubmit={saveTable} className="flex flex-wrap gap-2">
                    <input className={`${input} min-w-0 flex-1`} required maxLength={50} value={editTable.label} onChange={(e) => setEditTable({ ...editTable, label: e.target.value })} />
                    <input className={`${input} w-20`} required type="number" min={1} max={500} aria-label="Seats" value={editTable.seats} onChange={(e) => setEditTable({ ...editTable, seats: e.target.value })} />
                    <button className={button} disabled={busy}>Save</button>
                    <button type="button" className="text-xs text-secondary-500 hover:underline" onClick={() => setEditTable(null)}>Cancel</button>
                  </form>
                </li>
              ) : (
                <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>
                    {t.label} <span className="text-xs text-secondary-500">({t.seats} seats)</span>
                  </span>
                  <span className="flex gap-3 text-xs">
                    <button className="text-primary-600 hover:underline" onClick={() => setEditTable({ id: t.id, label: t.label, seats: String(t.seats) })}>Edit</button>
                    <button className="text-error-600 hover:underline" onClick={() => void removeTable(t)}>Remove</button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>

        <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Kitchen stations</h2>
          <p className="text-xs text-secondary-500">A prep area such as Kitchen, Grill or Bar. Each one gets its own kitchen screen. You need at least one.</p>
          <form onSubmit={addStation} className="flex flex-wrap gap-2">
            <input className={`${input} min-w-0 flex-1`} required maxLength={50} placeholder="Station name" value={stationName} onChange={(e) => setStationName(e.target.value)} />
            <button className={button} disabled={busy}>
              Add station
            </button>
          </form>
          {stations.length === 0 && <p className="text-xs text-secondary-500">No stations yet - table ordering is switched off until you add one.</p>}
          <ul className="divide-y divide-border text-sm">
            {stations.map((st) =>
              editStation?.id === st.id ? (
                <li key={st.id} className="py-2">
                  <form onSubmit={saveStation} className="flex flex-wrap gap-2">
                    <input className={`${input} min-w-0 flex-1`} required maxLength={50} value={editStation.name} onChange={(e) => setEditStation({ ...editStation, name: e.target.value })} />
                    <button className={button} disabled={busy}>Save</button>
                    <button type="button" className="text-xs text-secondary-500 hover:underline" onClick={() => setEditStation(null)}>Cancel</button>
                  </form>
                </li>
              ) : (
                <li key={st.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{st.name}</span>
                  <span className="flex gap-3 text-xs">
                    <button className="text-primary-600 hover:underline" onClick={() => setEditStation({ id: st.id, name: st.name })}>Rename</button>
                    <button className="text-error-600 hover:underline" onClick={() => void removeStation(st)}>Remove</button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      </div>

      <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Reserved tables</h2>
        <p className="text-xs text-secondary-500">A table with a confirmed reservation shows as Reserved on the floor from this many minutes before the booking time (and for an hour after, if the guests are late). A table that is already occupied or being cleaned keeps showing that.</p>
        <form onSubmit={saveLead} className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            Show as reserved
            <input className={`${input} w-24`} type="number" min={0} max={720} value={lead} onChange={(e) => setLead(e.target.value)} />
            minutes before
          </label>
          <button className={button} disabled={busy}>Save</button>
        </form>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <h2 className="font-semibold">Which station prepares each dish</h2>
          <p className="text-xs text-secondary-500">
            When a customer orders from their table, each dish goes to the station chosen here. A dish with no choice goes to your first station{stations[0] ? ` (${stations[0].name})` : ""}. A dish only shows on the table menu when it is marked to show online (Products), and it disappears by itself while any ingredient in its recipe is out of stock.
          </p>
        </div>
        {dishes === null ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : dishes.length === 0 ? (
          <p className="text-sm text-secondary-500">You have no products yet. Add your dishes under Products first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-secondary-500">
                <tr>
                  <th className="p-2">Dish</th>
                  <th className="p-2">Price</th>
                  <th className="p-2">On the online menu</th>
                  <th className="p-2">Station</th>
                </tr>
              </thead>
              <tbody>
                {dishes.map((d) => (
                  <tr key={d.variantId} className="border-t border-border">
                    <td className="p-2">
                      {d.name}
                      {d.sku && <span className="block text-xs text-secondary-500">{d.sku}</span>}
                      {d.hasRecipe && <span className="text-xs text-secondary-500">made from a recipe</span>}
                    </td>
                    <td className="p-2 font-mono">{kes(d.price)}</td>
                    <td className="p-2">{d.onlineVisible ? "Yes" : <span className="text-secondary-500">No</span>}</td>
                    <td className="p-2">
                      <select className={input} value={d.stationId ?? ""} onChange={(e) => void setStation(d, e.target.value)} disabled={stations.length === 0}>
                        <option value="">{stations[0] ? `First station (${stations[0].name})` : "No stations yet"}</option>
                        {stations.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
