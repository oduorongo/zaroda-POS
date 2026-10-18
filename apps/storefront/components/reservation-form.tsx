"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createReservation } from "../lib/api";

const RESERVATIONS_KEY = "zaroda_reservations";
const PHONE_KEY = "zaroda_reservation_phone";

/** Today in Kenya (UTC+3, no daylight saving) as YYYY-MM-DD. */
const kenyaToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

// Tables are usually asked for on the half hour; the guest can still type any time.
const TIMES = Array.from({ length: 24 }, (_, h) => [`${String(h).padStart(2, "0")}:00`, `${String(h).padStart(2, "0")}:30`]).flat().filter((t) => t >= "07:00" && t <= "23:00");

/** A guest asks a restaurant for a table. No account and no payment: the restaurant confirms or declines, and texts back. */
export default function ReservationForm({ slug, restaurant }: { slug: string; restaurant: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(() => {
    try {
      return localStorage.getItem(PHONE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState(kenyaToday());
  const [time, setTime] = useState("19:00");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const reservation = await createReservation(slug, { name: name.trim(), phone: phone.trim(), partySize, date, time, notes: notes.trim() || undefined });
      try {
        localStorage.setItem(PHONE_KEY, phone.trim());
        const saved = JSON.parse(localStorage.getItem(RESERVATIONS_KEY) ?? "{}") as Record<string, string>;
        localStorage.setItem(RESERVATIONS_KEY, JSON.stringify({ ...saved, [reservation.id]: reservation.guestToken }));
      } catch {
        /* the link the guest is sent to carries the secret anyway */
      }
      router.push(`/r/${reservation.id}?k=${encodeURIComponent(reservation.guestToken)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send your request. Please try again.");
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";
  return (
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-4 rounded-lg border border-border bg-surface p-5">
      <div>
        <h1 className="text-2xl font-bold">Reserve a table</h1>
        <p className="mt-1 text-sm text-secondary-600">at {restaurant}. Tell us when and how many; the restaurant will confirm and text you. There&apos;s nothing to pay.</p>
      </div>
      <label className="block text-sm font-medium">
        Your name
        <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" className={field} />
      </label>
      <label className="block text-sm font-medium">
        Phone number
        <input required type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" className={field} />
        <span className="mt-1 block text-xs font-normal text-secondary-500">The restaurant texts you here to confirm.</span>
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm font-medium">
          People
          <input required type="number" min={1} max={30} value={partySize} onChange={(e) => setPartySize(Number(e.target.value))} className={field} />
        </label>
        <label className="text-sm font-medium">
          Date
          <input required type="date" min={kenyaToday()} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="text-sm font-medium">
          Time
          <select value={time} onChange={(e) => setTime(e.target.value)} className={field}>
            {TIMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">
        Anything we should know? <span className="font-normal text-secondary-500">(optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="e.g. birthday, high chair, quiet corner" className={field} />
      </label>
      {error && <p className="text-sm text-error-600">{error}</p>}
      <button type="submit" disabled={busy || name.trim().length < 2 || phone.trim().length < 9} className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
        {busy ? "Sending..." : "Request this table"}
      </button>
    </form>
  );
}
