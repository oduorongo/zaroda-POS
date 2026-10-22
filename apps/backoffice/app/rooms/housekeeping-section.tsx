"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch, ApiError } from "../../lib/api";
import type { Room, RoomStatus } from "../front-desk/types";

const COLUMNS: [RoomStatus, string, string][] = [
  ["VACANT_DIRTY", "Needs cleaning", "border-amber-700"],
  ["VACANT_CLEAN", "Clean and ready", "border-green-700"],
  ["OCCUPIED", "Occupied", "border-blue-700"],
  ["OUT_OF_ORDER", "Out of order", "border-red-800"],
];

/** The housekeeping board: rooms by status. Staff mark a room clean when it is ready, dirty, or out of order. */
export function HousekeepingSection() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRooms(await apiGet<Room[]>("/hotel/rooms"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the rooms.");
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function set(room: Room, status: "VACANT_CLEAN" | "VACANT_DIRTY" | "OUT_OF_ORDER") {
    try {
      await apiPatch(`/hotel/rooms/${room.id}/status`, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change that room.");
    }
  }

  if (rooms === null) return <p className="text-sm text-secondary-500">{error ?? "Loading..."}</p>;
  if (rooms.length === 0) return <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">Add your rooms first (the Rooms tab).</p>;

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      <div className="grid gap-3 md:grid-cols-4">
        {COLUMNS.map(([status, label, tone]) => {
          const here = rooms.filter((r) => r.status === status);
          return (
            <section key={status} className={`space-y-2 rounded-lg border-2 bg-surface p-3 ${tone}`}>
              <h2 className="text-sm font-semibold">{label} <span className="font-normal text-secondary-500">({here.length})</span></h2>
              {here.length === 0 && <p className="text-xs text-secondary-500">None</p>}
              {here.map((r) => (
                <div key={r.id} className="rounded-md bg-background p-2 text-sm">
                  <p className="font-bold">Room {r.number} <span className="text-xs font-normal text-secondary-500">{r.roomTypeName}</span></p>
                  {r.guest && <p className="text-xs text-secondary-500">{r.guest.name} · out {r.guest.checkOut}</p>}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {status !== "OCCUPIED" && status !== "VACANT_CLEAN" && <button className="text-green-500 hover:underline" onClick={() => void set(r, "VACANT_CLEAN")}>Mark clean</button>}
                    {status === "VACANT_CLEAN" && <button className="text-amber-500 hover:underline" onClick={() => void set(r, "VACANT_DIRTY")}>Mark dirty</button>}
                    {status !== "OCCUPIED" && status !== "OUT_OF_ORDER" && <button className="text-red-400 hover:underline" onClick={() => void set(r, "OUT_OF_ORDER")}>Out of order</button>}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
