"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { CheckInPanel, CheckOutPanel, FolioPanel, MovePanel, NewBookingPanel } from "./panels";
import { CancelPanel, ChangeStayPanel, NightAuditPanel } from "./ops-panels";
import { kes, primaryBtn, ghostBtn, type Board, type DeskBooking, type RoomStatus, type RoomType } from "./types";

type Panel = { kind: "new" | "audit" } | { kind: "checkin" | "checkout" | "folio" | "move" | "change" | "cancel" | "noshow"; booking: DeskBooking };

const ROOM_TONE: Record<RoomStatus, string> = {
  VACANT_CLEAN: "border-green-700 bg-green-950/40",
  VACANT_DIRTY: "border-amber-700 bg-amber-950/40",
  OCCUPIED: "border-blue-700 bg-blue-950/40",
  OUT_OF_ORDER: "border-red-800 bg-red-950/40",
};
const ROOM_LABEL: Record<RoomStatus, string> = { VACANT_CLEAN: "Clean", VACANT_DIRTY: "Needs cleaning", OCCUPIED: "Occupied", OUT_OF_ORDER: "Out of order" };
const SOURCE: Record<string, string> = { MARKETPLACE: "Online", FRONT_DESK: "Walk-in", PHONE: "Phone" };

/** The hotel's day: who arrives, who is in, who leaves, and the rooms. Quick actions for new booking, check-in, payment and check-out. */
export default function FrontDeskPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [types, setTypes] = useState<RoomType[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, t] = await Promise.all([apiGet<Board>("/hotel/desk"), apiGet<RoomType[]>("/hotel/room-types").catch(() => [] as RoomType[])]);
      setBoard(b);
      setTypes(t.filter((x) => x.isActive));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the front desk.");
    }
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    if (s.industryType !== "HOTEL" && s.industryType !== "RESTAURANT") return void router.replace("/sales");
    setSession(s);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    void load();
    const timer = setInterval(() => !panel && void load(), 20_000);
    return () => clearInterval(timer);
  }, [session, load, panel]);

  if (!session) return null;
  const isManager = session.role === "MANAGER" || session.role === "OWNER";
  const canWork = isManager; // the back office is for owners and managers; reception works from the same API
  const done = (message: string) => {
    setPanel(null);
    setNotice(message);
    void load();
  };

  const row = (b: DeskBooking, actions: React.ReactNode) => (
    <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
      <div>
        <p className="font-semibold">
          {b.guestName} <span className="font-mono text-xs text-secondary-500">{b.bookingNumber}</span>
          <span className="ml-2 rounded bg-secondary-500/15 px-1.5 py-0.5 text-xs">{SOURCE[b.source]}</span>
        </p>
        <p className="text-xs text-secondary-500">
          {b.roomTypeName}
          {b.rooms > 1 ? ` x ${b.rooms}` : ""}
          {b.roomNumbers.length > 0 ? ` · Room ${b.roomNumbers.join(", ")}` : ""} · {b.checkIn} to {b.checkOut} · {b.guests} guest{b.guests === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-secondary-500">
          {b.guestPhone}
          {b.idNumber ? ` · ID ${b.idNumber}` : ""}
        </p>
      </div>
      <div className="text-right">
        {b.balance !== null ? (
          <p className={`font-mono text-sm font-bold ${b.balance > 0.01 ? "text-amber-500" : "text-green-500"}`}>{b.balance > 0.01 ? `Owes ${kes(b.balance)}` : b.balance < -0.01 ? `Owed back ${kes(-b.balance)}` : "Settled"}</p>
        ) : (
          <p className="text-xs text-secondary-500">{b.paid > 0 ? `${kes(b.paid)} paid` : "Nothing paid yet"}</p>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </li>
  );

  const list = (title: string, items: DeskBooking[], empty: string, actions: (b: DeskBooking) => React.ReactNode) => (
    <section className="space-y-2">
      <h2 className="font-semibold">
        {title} <span className="text-sm font-normal text-secondary-500">({items.length})</span>
      </h2>
      {items.length === 0 ? <p className="rounded-lg border border-border bg-surface p-3 text-sm text-secondary-500">{empty}</p> : <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{items.map((b) => row(b, actions(b)))}</ul>}
    </section>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-5xl space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">Front desk</h1>
            <p className="text-sm text-secondary-500">{board ? new Date(`${board.date}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "Today"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/rooms" className={ghostBtn}>Rooms &amp; housekeeping</Link>
            {isManager && <Link href="/hotel-reports" className={ghostBtn}>Reports</Link>}
            {isManager && <Link href="/hotel-settings" className={ghostBtn}>Rates &amp; rules</Link>}
            {canWork && <button className={ghostBtn} onClick={() => setPanel({ kind: "audit" })}>Close the day</button>}
            {canWork && <button className={primaryBtn} onClick={() => setPanel({ kind: "new" })} disabled={types.length === 0}>New booking</button>}
          </div>
        </div>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        {board && types.length === 0 && <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">Add a room type and your rooms first (Rooms &amp; housekeeping).</p>}

        {board && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              {(Object.keys(ROOM_LABEL) as RoomStatus[]).map((s) => (
                <span key={s} className={`rounded-md border px-3 py-1.5 ${ROOM_TONE[s]}`}>
                  <strong>{board.roomCounts[s]}</strong> {ROOM_LABEL[s].toLowerCase()}
                </span>
              ))}
              <span className="rounded-md border border-border px-3 py-1.5"><strong>{board.arrivals.length}</strong> arriving</span>
              <span className="rounded-md border border-border px-3 py-1.5"><strong>{board.inHouse.length}</strong> in the house</span>
              <span className="rounded-md border border-border px-3 py-1.5"><strong>{board.departures.length}</strong> leaving</span>
            </div>

            {list("Arriving today", board.arrivals, "Nobody is expected today.", (b) => (
              <>
                <button className={ghostBtn} onClick={() => setPanel({ kind: "folio", booking: b })}>Payment</button>
                {canWork && <button className={ghostBtn} onClick={() => setPanel({ kind: "change", booking: b })}>Change</button>}
                {canWork && <button className={ghostBtn} onClick={() => setPanel({ kind: "cancel", booking: b })}>Cancel</button>}
                {canWork && <button className={ghostBtn} onClick={() => setPanel({ kind: "noshow", booking: b })}>No-show</button>}
                {canWork && <button className={primaryBtn} onClick={() => setPanel({ kind: "checkin", booking: b })}>Check in</button>}
              </>
            ))}
            {list("Leaving today", board.departures, "Nobody is due to leave.", (b) => (
              <>
                <button className={ghostBtn} onClick={() => setPanel({ kind: "folio", booking: b })}>Folio</button>
                {canWork && <button className={primaryBtn} onClick={() => setPanel({ kind: "checkout", booking: b })}>Check out</button>}
              </>
            ))}
            {list("In the house", board.inHouse, "Nobody is checked in.", (b) => (
              <>
                <button className={ghostBtn} onClick={() => setPanel({ kind: "folio", booking: b })}>Folio / payment</button>
                {canWork && <button className={ghostBtn} onClick={() => setPanel({ kind: "change", booking: b })}>Change stay</button>}
                {canWork && <button className={ghostBtn} onClick={() => setPanel({ kind: "move", booking: b })}>Move room</button>}
                {canWork && <button className={primaryBtn} onClick={() => setPanel({ kind: "checkout", booking: b })}>Check out</button>}
              </>
            ))}

            <section className="space-y-2">
              <h2 className="font-semibold">Rooms</h2>
              {board.rooms.length === 0 ? (
                <p className="rounded-lg border border-border bg-surface p-3 text-sm text-secondary-500">You have not added any rooms yet. Add them under Rooms &amp; housekeeping.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {board.rooms.map((r) => (
                    <div key={r.id} className={`rounded-lg border p-2 text-center text-xs ${ROOM_TONE[r.status]}`}>
                      <p className="text-base font-bold">{r.number}</p>
                      <p className="text-secondary-500">{r.roomTypeName}</p>
                      <p>{ROOM_LABEL[r.status]}</p>
                      {r.guest && <p className="mt-0.5 truncate font-medium">{r.guest.name}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {panel?.kind === "new" && board && <NewBookingPanel types={types} rooms={board.rooms} isManager={isManager} onClose={() => setPanel(null)} onDone={done} />}
        {panel?.kind === "checkin" && board && <CheckInPanel booking={panel.booking} board={board} isManager={isManager} onClose={() => setPanel(null)} onDone={(m) => { done(m); window.open(`/hotel-print/card/${panel.booking.id}`, "_blank"); }} />}
        {panel?.kind === "checkout" && <CheckOutPanel booking={panel.booking} isManager={isManager} onClose={() => setPanel(null)} onDone={(m, id) => { done(m); window.open(`/hotel-print/folio/${id}`, "_blank"); }} />}
        {panel?.kind === "folio" && <FolioPanel booking={panel.booking} isManager={isManager} onClose={() => setPanel(null)} onChanged={() => void load()} />}
        {panel?.kind === "change" && board && <ChangeStayPanel booking={panel.booking} types={types} board={board} isManager={isManager} onClose={() => setPanel(null)} onDone={done} />}
        {(panel?.kind === "cancel" || panel?.kind === "noshow") && <CancelPanel booking={panel.booking} isManager={isManager} noShow={panel.kind === "noshow"} onClose={() => setPanel(null)} onDone={done} />}
        {panel?.kind === "audit" && <NightAuditPanel onClose={() => setPanel(null)} onDone={() => done("Day closed.")} />}
        {panel?.kind === "move" && board && <MovePanel booking={panel.booking} board={board} onClose={() => setPanel(null)} onDone={done} />}
      </main>
    </div>
  );
}
