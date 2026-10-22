"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import type { Room, RoomType } from "../front-desk/types";

const input = "rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";

/** The hotel's real rooms (101, 102...). A room type's quantity follows its active rooms once it has any. */
export function RoomsSection() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [types, setTypes] = useState<RoomType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [one, setOne] = useState({ roomTypeId: "", number: "", floor: "" });
  const [many, setMany] = useState({ roomTypeId: "", prefix: "", from: "101", to: "110", floor: "" });
  const [edit, setEdit] = useState<{ id: string; number: string; floor: string; notes: string } | null>(null);

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);
  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([apiGet<Room[]>("/hotel/rooms?includeInactive=true"), apiGet<RoomType[]>("/hotel/room-types")]);
      setRooms(r);
      setTypes(t.filter((x) => x.isActive));
      setOne((o) => ({ ...o, roomTypeId: o.roomTypeId || t[0]?.id || "" }));
      setMany((m) => ({ ...m, roomTypeId: m.roomTypeId || t[0]?.id || "" }));
    } catch (err) {
      fail(err, "Could not load your rooms.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
      setNotice(done);
      await load();
    } catch (err) {
      fail(err, "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (rooms === null) return <p className="text-sm text-secondary-500">{error ?? "Loading..."}</p>;
  if (types.length === 0) return <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">Add a room type first (Room types &amp; photos), then add the real rooms here.</p>;

  return (
    <div className="space-y-5">
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
      <p className="text-sm text-secondary-500">Once a room type has real rooms, the number of active rooms is how many you can sell of that type (online and at the desk).</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <form onSubmit={(e) => { e.preventDefault(); void run(() => apiPost("/hotel/rooms", { roomTypeId: one.roomTypeId, number: one.number.trim(), floor: one.floor.trim() || undefined }), `Room ${one.number} added.`).then(() => setOne({ ...one, number: "" })); }} className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Add one room</h2>
          <select className={`${input} w-full`} value={one.roomTypeId} onChange={(e) => setOne({ ...one, roomTypeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <div className="flex gap-2">
            <input required maxLength={20} className={`${input} flex-1`} placeholder="Room number" value={one.number} onChange={(e) => setOne({ ...one, number: e.target.value })} />
            <input maxLength={20} className={`${input} w-24`} placeholder="Floor" value={one.floor} onChange={(e) => setOne({ ...one, floor: e.target.value })} />
          </div>
          <button className={button} disabled={busy}>Add room</button>
        </form>

        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await apiPost<{ added: number }>("/hotel/rooms/bulk", { roomTypeId: many.roomTypeId, prefix: many.prefix || undefined, from: Number(many.from), to: Number(many.to), floor: many.floor.trim() || undefined }); setNotice(`${r.added} rooms added.`); }, "Rooms added."); }} className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Add a run of rooms</h2>
          <select className={`${input} w-full`} value={many.roomTypeId} onChange={(e) => setMany({ ...many, roomTypeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <div className="flex gap-2">
            <input maxLength={10} className={`${input} w-20`} placeholder="Prefix" value={many.prefix} onChange={(e) => setMany({ ...many, prefix: e.target.value })} />
            <input required type="number" min={0} className={`${input} w-24`} value={many.from} onChange={(e) => setMany({ ...many, from: e.target.value })} />
            <span className="self-center text-sm">to</span>
            <input required type="number" min={0} className={`${input} w-24`} value={many.to} onChange={(e) => setMany({ ...many, to: e.target.value })} />
          </div>
          <button className={button} disabled={busy}>Add rooms</button>
        </form>
      </div>

      {types.map((t) => {
        const mine = rooms.filter((r) => r.roomTypeId === t.id);
        if (mine.length === 0) return null;
        return (
          <section key={t.id} className="space-y-2">
            <h2 className="font-semibold">{t.name} <span className="text-sm font-normal text-secondary-500">({mine.filter((r) => r.isActive).length} in use)</span></h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {mine.map((r) =>
                edit?.id === r.id ? (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 p-2">
                    <input className={`${input} w-28`} value={edit.number} onChange={(e) => setEdit({ ...edit, number: e.target.value })} />
                    <input className={`${input} w-24`} placeholder="Floor" value={edit.floor} onChange={(e) => setEdit({ ...edit, floor: e.target.value })} />
                    <input className={`${input} min-w-0 flex-1`} placeholder="Notes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                    <button className={button} onClick={() => void run(() => apiPatch(`/hotel/rooms/${r.id}`, { number: edit.number.trim(), floor: edit.floor, notes: edit.notes }), "Saved.").then(() => setEdit(null))}>Save</button>
                    <button className="text-xs text-secondary-500" onClick={() => setEdit(null)}>Cancel</button>
                  </li>
                ) : (
                  <li key={r.id} className={`flex items-center justify-between gap-2 p-2 text-sm ${r.isActive ? "" : "opacity-50"}`}>
                    <span>
                      <strong>Room {r.number}</strong>
                      {r.floor ? ` · floor ${r.floor}` : ""}
                      {r.notes ? <span className="text-xs text-secondary-500"> · {r.notes}</span> : null}
                      {!r.isActive && <span className="ml-2 text-xs">not in use</span>}
                    </span>
                    <span className="flex gap-3 text-xs">
                      <button className="text-primary-600 hover:underline" onClick={() => setEdit({ id: r.id, number: r.number, floor: r.floor ?? "", notes: r.notes ?? "" })}>Edit</button>
                      <button className="text-error-600 hover:underline" onClick={() => void run(() => apiPatch(`/hotel/rooms/${r.id}`, { isActive: !r.isActive }), r.isActive ? `Room ${r.number} taken out of use.` : `Room ${r.number} back in use.`)}>{r.isActive ? "Take out of use" : "Use again"}</button>
                    </span>
                  </li>
                ),
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
