"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, ApiError } from "../../lib/api";

type Status = "REQUESTED" | "CONFIRMED" | "DECLINED" | "CANCELLED" | "SEATED" | "NO_SHOW";

export interface Reservation {
  id: string;
  reservationNumber: string;
  status: Status;
  guestName: string;
  guestPhone: string;
  partySize: number;
  date: string;
  time: string;
  notes: string | null;
  restaurantNote: string | null;
  tableId: string | null;
  tableLabel: string | null;
}
interface Table {
  id: string;
  label: string;
  seats: number;
}

const LABEL: Record<Status, string> = { REQUESTED: "Needs an answer", CONFIRMED: "Confirmed", DECLINED: "Declined", CANCELLED: "Cancelled", SEATED: "Seated", NO_SHOW: "No-show" };
const TONE: Record<Status, string> = {
  REQUESTED: "bg-amber-500/15 text-amber-600",
  CONFIRMED: "bg-green-600/15 text-green-600",
  DECLINED: "bg-secondary-500/15 text-secondary-500",
  CANCELLED: "bg-secondary-500/15 text-secondary-500",
  SEATED: "bg-blue-500/15 text-blue-500",
  NO_SHOW: "bg-red-500/15 text-red-500",
};
const input = "rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const nice = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Today's confirmed reservations, for the floor view: who is expected, when, and at which table. */
export function TodaysReservations() {
  const [rows, setRows] = useState<Reservation[]>([]);
  useEffect(() => {
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    apiGet<Reservation[]>(`/restaurant/reservations?date=${today}`)
      .then((all) => setRows(all.filter((r) => r.status === "CONFIRMED" || r.status === "REQUESTED")))
      .catch(() => undefined);
  }, []);
  if (rows.length === 0) return null;
  return (
    <div className="mb-6 rounded-lg border border-border bg-surface p-3">
      <h2 className="mb-2 font-semibold">Expected today</h2>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3">
            <span className="font-mono font-semibold">{r.time}</span>
            <span>
              {r.guestName} · {r.partySize} {r.partySize === 1 ? "person" : "people"}
            </span>
            <span className="text-secondary-500">{r.tableLabel ?? "no table yet"}</span>
            {r.status === "REQUESTED" && <span className={`rounded-full px-2 py-0.5 text-xs ${TONE.REQUESTED}`}>needs an answer</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Guests ask for tables from the marketplace; the restaurant switches that on here, then confirms (optionally giving a
 * table) or declines each request. The guest is texted either way. Seating a party marks their table Occupied.
 */
export function ReservationsSection({ tables }: { tables: Table[] }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [answering, setAnswering] = useState<{ reservation: Reservation; mode: "confirm" | "decline" | "cancel" } | null>(null);
  const [tableId, setTableId] = useState("");
  const [text, setText] = useState("");

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);
  async function load() {
    try {
      const [settings, list] = await Promise.all([apiGet<{ enabled: boolean }>("/restaurant/reservations/settings"), apiGet<Reservation[]>("/restaurant/reservations")]);
      setEnabled(settings.enabled);
      setReservations(list);
    } catch (err) {
      fail(err, "Could not load your reservations.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggle(next: boolean) {
    setError(null);
    setNotice(null);
    try {
      await apiPut("/restaurant/reservations/settings", { enabled: next });
      setEnabled(next);
      setNotice(next ? "Reservations are on. A \"Reserve a table\" link now shows on your page on the marketplace." : "Reservations are off. Requests you already have are kept.");
    } catch (err) {
      fail(err, "Could not change that.");
    }
  }

  async function act(key: string, path: string, body: unknown, done: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await apiPost(path, body);
      setNotice(done);
      setAnswering(null);
      await load();
    } catch (err) {
      fail(err, "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (reservations === null || enabled === null) return <p className="text-sm text-secondary-500">{error ?? "Loading..."}</p>;

  const byDay = new Map<string, Reservation[]>();
  for (const r of reservations) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
  const needAnswer = reservations.filter((r) => r.status === "REQUESTED").length;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
        <div>
          <p className="font-medium">Take table requests from the marketplace</p>
          <p className="text-xs text-secondary-500">Guests ask for a date, time and number of people. Nothing is paid; you confirm or decline and they are texted. You are texted for each new request.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => void toggle(e.target.checked)} /> {enabled ? "On" : "Off"}
        </label>
      </div>

      {needAnswer > 0 && <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">{needAnswer} request{needAnswer === 1 ? "" : "s"} waiting for your answer.</p>}

      {reservations.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No upcoming reservations. Requests appear here as soon as a guest asks for a table.</p>
      ) : (
        Array.from(byDay.entries()).map(([date, rows]) => (
          <div key={date} className="space-y-2">
            <h2 className="font-semibold">{nice(date)}</h2>
            {rows.map((r) => (
              <div key={r.id} className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      <span className="font-mono">{r.time}</span> · {r.guestName} · {r.partySize} {r.partySize === 1 ? "person" : "people"}{" "}
                      <span className="font-mono text-xs text-secondary-500">{r.reservationNumber}</span>
                    </p>
                    <p className="text-xs text-secondary-500">
                      <a href={`tel:+${r.guestPhone}`} className="underline">
                        {r.guestPhone}
                      </a>
                      {r.tableLabel ? ` · ${r.tableLabel}` : ""}
                    </p>
                    {r.notes && <p className="text-xs text-amber-500">{r.notes}</p>}
                    {r.restaurantNote && <p className="text-xs text-secondary-500">You said: {r.restaurantNote}</p>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}>{LABEL[r.status]}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.status === "REQUESTED" && (
                    <>
                      <button className={button} onClick={() => { setAnswering({ reservation: r, mode: "confirm" }); setTableId(""); setText(""); }}>
                        Confirm
                      </button>
                      <button className={ghost} onClick={() => { setAnswering({ reservation: r, mode: "decline" }); setText(""); }}>
                        Decline
                      </button>
                    </>
                  )}
                  {r.status === "CONFIRMED" && (
                    <>
                      <button className={button} disabled={busy !== null} onClick={() => void act(`s-${r.id}`, `/restaurant/reservations/${r.id}/seat`, {}, `${r.guestName}'s party is seated${r.tableLabel ? ` at ${r.tableLabel}` : ""}.`)}>
                        Seat them
                      </button>
                      <button className={ghost} disabled={busy !== null} onClick={() => window.confirm(`Mark ${r.guestName} as a no-show?`) && void act(`n-${r.id}`, `/restaurant/reservations/${r.id}/no-show`, {}, "Marked as a no-show.")}>
                        No-show
                      </button>
                      <button className={ghost} onClick={() => { setAnswering({ reservation: r, mode: "cancel" }); setText(""); }}>
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {answering && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h3 className="font-semibold">
            {answering.mode === "confirm" ? "Confirm" : answering.mode === "decline" ? "Decline" : "Cancel"} {answering.reservation.guestName}&apos;s table for {answering.reservation.partySize} at {answering.reservation.time}
          </h3>
          {answering.mode === "confirm" && (
            <label className="block text-sm">
              Table <span className="text-secondary-500">(optional - choose one so the floor shows who is expected where)</span>
              <select className={`${input} mt-1 w-full`} value={tableId} onChange={(e) => setTableId(e.target.value)}>
                <option value="">No table yet</option>
                {tables
                  .filter((t) => t.seats >= answering.reservation.partySize)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} (seats {t.seats})
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="block text-sm">
            {answering.mode === "confirm" ? "Message to the guest (optional)" : "Reason (the guest is told)"}
            <input className={`${input} mt-1 w-full`} value={text} maxLength={150} onChange={(e) => setText(e.target.value)} placeholder={answering.mode === "confirm" ? "e.g. We will hold the table for 15 minutes" : "e.g. We are fully booked at that time"} />
          </label>
          <div className="flex gap-2">
            <button
              className={button}
              disabled={busy !== null || (answering.mode !== "confirm" && text.trim().length < 3)}
              onClick={() =>
                void act(
                  `a-${answering.reservation.id}`,
                  `/restaurant/reservations/${answering.reservation.id}/${answering.mode}`,
                  answering.mode === "confirm" ? { tableId: tableId || undefined, message: text.trim() || undefined } : { reason: text.trim() },
                  answering.mode === "confirm" ? "Confirmed - the guest has been texted." : answering.mode === "decline" ? "Declined - the guest has been texted." : "Cancelled - the guest has been texted.",
                )
              }
            >
              {answering.mode === "confirm" ? "Confirm and text the guest" : answering.mode === "decline" ? "Decline and text the guest" : "Cancel and text the guest"}
            </button>
            <button className={ghost} onClick={() => setAnswering(null)}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
