"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Today in Kenya (UTC+3, no daylight saving) as YYYY-MM-DD - the earliest check-in a guest can pick. */
function kenyaToday() {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Where and when: reloads the page with the dates (and, on the Hotels list, an area) in the address, so the result can be shared. */
export default function StayPicker({ checkIn: initialIn, checkOut: initialOut, area: initialArea, withArea }: { checkIn?: string; checkOut?: string; area?: string; withArea?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const today = kenyaToday();
  const [checkIn, setCheckIn] = useState(initialIn ?? "");
  const [checkOut, setCheckOut] = useState(initialOut ?? "");
  const [area, setArea] = useState(initialArea ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = new URLSearchParams();
    if (withArea && area.trim()) query.set("area", area.trim());
    if (checkIn && checkOut) {
      query.set("checkIn", checkIn);
      query.set("checkOut", checkOut);
    }
    router.push(`${pathname}${query.toString() ? `?${query}` : ""}`);
  }

  const field = "w-full rounded-md border border-border bg-surface p-2.5 text-sm text-foreground";
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
      {withArea && <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Town or area" aria-label="Town or area" className={`${field} sm:col-span-1`} />}
      <label className="text-xs text-secondary-500">
        Check-in
        <input
          type="date"
          min={today}
          value={checkIn}
          onChange={(e) => {
            setCheckIn(e.target.value);
            if (!checkOut || checkOut <= e.target.value) setCheckOut(e.target.value ? addDays(e.target.value, 1) : "");
          }}
          className={field}
        />
      </label>
      <label className="text-xs text-secondary-500">
        Check-out
        <input type="date" min={checkIn ? addDays(checkIn, 1) : addDays(today, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={field} />
      </label>
      <button type="submit" className="self-end rounded-md bg-primary-600 px-5 py-2.5 font-semibold text-white hover:bg-primary-700">
        Search
      </button>
    </form>
  );
}
