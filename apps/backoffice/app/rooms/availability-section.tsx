"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../../lib/api";

interface Grid {
  from: string;
  nights: string[];
  roomTypes: { id: string; name: string; quantity: number; free: number[] }[];
}

const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "short", timeZone: "UTC" });

/** How many rooms of each type are free on each of the next two weeks' nights (paid and waiting bookings both hold their rooms). */
export function AvailabilitySection() {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Grid>("/hotel/availability?days=14")
      .then(setGrid)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the calendar."));
  }, []);

  if (!grid) return <p className="text-sm text-secondary-500">{error ?? "Loading..."}</p>;
  if (grid.roomTypes.length === 0) return <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">Add a room type first and its calendar shows here.</p>;

  return (
    <div className="space-y-2">
      <p className="text-sm text-secondary-500">Free rooms for each night. Red means fully booked.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-center text-sm">
          <thead className="bg-surface text-xs text-secondary-500">
            <tr>
              <th className="p-2 text-left">Room type</th>
              {grid.nights.map((n) => (
                <th key={n} className="p-2 font-normal">
                  <span className="block">{weekday(n)}</span>
                  <span className="block">{short(n)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.roomTypes.map((rt) => (
              <tr key={rt.id} className="border-t border-border">
                <td className="whitespace-nowrap p-2 text-left font-medium">
                  {rt.name}
                  <span className="block text-xs font-normal text-secondary-500">{rt.quantity} in total</span>
                </td>
                {rt.free.map((free, i) => (
                  <td key={grid.nights[i]} className={`p-2 font-mono ${free <= 0 ? "bg-red-500/15 text-red-500" : free <= 1 ? "bg-amber-500/10 text-amber-600" : ""}`}>
                    {Math.max(0, free)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
