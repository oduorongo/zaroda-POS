"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { SetupSection } from "./setup-section";
import { QrSection } from "./qr-section";
import { ReservationsSection, TodaysReservations } from "./reservations-section";

interface Branch {
  id: string;
  name: string;
}

type TableStatus = "AVAILABLE" | "OCCUPIED" | "RESERVED" | "NEEDS_CLEANING";

interface RestaurantTable {
  id: string;
  label: string;
  seats: number;
  status: TableStatus;
  reservation: { guestName: string; time: string } | null;
  tab: { id: string; openedAt: string; guestCount: number; itemCount: number; total: number } | null;
}

interface HeldCourse {
  source: "TAB" | "SALE";
  tabId: string | null;
  saleId: string | null;
  courseNumber: number;
  items: { title: string; quantity: number; station: string }[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface KitchenStation {
  id: string;
  name: string;
}

interface KitchenTicketLine {
  id: string;
  quantity: number;
  voidedAt: string | null;
  variant: { product: { name: string } };
}

interface KitchenTicket {
  id: string;
  courseNumber: number;
  status: string;
  createdAt: string;
  lines: KitchenTicketLine[];
  station: { name: string };
  tab: { table: { label: string } } | null;
  sale: { restaurantTable: { table: { label: string } } | null } | null;
}

const STATUS_COLOR: Record<TableStatus, string> = {
  AVAILABLE: "border-green-700",
  OCCUPIED: "border-amber-700",
  RESERVED: "border-primary-700",
  NEEDS_CLEANING: "border-red-700",
};

/**
 * A read-mostly overview for the restaurant vertical - the terminal PWA
 * (app/tables, app/kds) is where a server/cook actually works a shift;
 * this is for a manager checking the floor and kitchen queue without
 * walking to a terminal. Redirects away if this org isn't RESTAURANT,
 * the same guard the terminal PWA's own vertical pages use.
 */
export default function RestaurantPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [held, setHeld] = useState<Record<string, HeldCourse[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"floor" | "setup" | "qr" | "reservations">("floor");

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    if (s.industryType !== "RESTAURANT" && s.industryType !== "HOTEL") {
      router.replace("/sales");
      return;
    }
    setSessionState(s);
    void (async () => {
      try {
        const branchList = await apiGet<Branch[]>("/branches");
        setBranches(branchList);
        setBranchId(branchList[0]?.id ?? "");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load branches.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!session || !branchId) return;
    void loadFloor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, branchId]);

  async function loadFloor() {
    setError(null);
    try {
      const [tableList, stationList] = await Promise.all([
        apiGet<RestaurantTable[]>(`/restaurant/tables?branchId=${branchId}`),
        apiGet<KitchenStation[]>(`/restaurant/stations?branchId=${branchId}`),
      ]);
      setTables(tableList);
      setStations(stationList);
      const ticketLists = await Promise.all(
        stationList.map((s) => apiGet<KitchenTicket[]>(`/restaurant/kitchen-tickets?stationId=${s.id}`)),
      );
      // a held course is not on the kitchen screen until it is fired
      setTickets(ticketLists.flat().filter((t) => t.status !== "SERVED" && t.status !== "HELD"));
      // courses still waiting to be fired come from the server, so they are still shown after a refresh
      const busy = tableList.filter((t) => t.status === "OCCUPIED" || t.status === "NEEDS_CLEANING");
      const lists = await Promise.all(busy.map((t) => apiGet<HeldCourse[]>(`/restaurant/tables/${t.id}/held-courses`).catch(() => [] as HeldCourse[])));
      setHeld(Object.fromEntries(busy.map((t, i) => [t.id, lists[i]]).filter(([, l]) => (l as HeldCourse[]).length > 0)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the floor.");
    }
  }

  async function markClean(table: RestaurantTable) {
    try {
      await apiPost(`/restaurant/tables/${table.id}/clean`, {});
      await loadFloor();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the table.");
    }
  }

  async function fire(course: HeldCourse) {
    try {
      await apiPost(course.source === "TAB" ? `/restaurant/tabs/${course.tabId}/courses/${course.courseNumber}/fire` : `/restaurant/sales/${course.saleId}/courses/${course.courseNumber}/fire`, {});
      await loadFloor();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that course to the kitchen.");
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="print:hidden">
        <Nav session={session} />
        <PageHeader />
      </div>
      <main className="mx-auto max-w-5xl p-6 print:max-w-none print:p-0">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <h1 className="text-xl font-bold">Restaurant floor</h1>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-md border border-border bg-surface p-2 text-sm"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300 print:hidden">{error}</p>}
        {loading && <p className="text-secondary-500">Loading...</p>}

        {!loading && (
          <div className="mb-4 flex flex-wrap gap-2 print:hidden">
            {(
              [
                ["floor", "Floor & kitchen"],
                ["setup", "Menu & kitchen setup"],
                ["qr", "Table QR codes"],
                ["reservations", "Reservations"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} className={`rounded-md px-3 py-2 text-sm ${tab === key ? "bg-primary-600 text-white" : "border border-border bg-surface"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {!loading && tab === "setup" && branchId && <SetupSection branchId={branchId} tables={tables} stations={stations} onChanged={() => void loadFloor()} />}
        {!loading && tab === "qr" && <QrSection tables={tables} stationCount={stations.length} />}
        {!loading && tab === "reservations" && <ReservationsSection tables={tables} />}

        {!loading && tab === "floor" && (
          <>
            <TodaysReservations />
            <h2 className="mb-2 font-semibold">Tables</h2>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {tables.map((t) => (
                <div key={t.id} className={`rounded-lg border-2 bg-surface p-3 text-center ${STATUS_COLOR[t.status]}`}>
                  <p className="font-bold">{t.label}</p>
                  <p className="text-xs text-secondary-500">{t.seats} seats</p>
                  <p className="mt-1 text-xs uppercase tracking-wide">{t.status.replace("_", " ")}</p>
                  {t.tab && (
                    <p className="mt-1 font-mono text-sm font-bold">
                      {kes(t.tab.total)} <span className="text-xs font-normal">· {t.tab.itemCount} items</span>
                    </p>
                  )}
                  {t.status === "RESERVED" && t.reservation && (
                    <p className="mt-1 text-xs">
                      {t.reservation.guestName} at {t.reservation.time}
                    </p>
                  )}
                  {t.status === "NEEDS_CLEANING" && (
                    <button
                      onClick={() => void markClean(t)}
                      className="mt-2 rounded bg-background/60 px-2 py-1 text-xs hover:bg-background"
                    >
                      Mark clean
                    </button>
                  )}
                  {(held[t.id] ?? []).map((c) => (
                    <button
                      key={`${c.tabId ?? c.saleId}-${c.courseNumber}`}
                      onClick={() => void fire(c)}
                      className="mt-2 block w-full rounded bg-amber-700 px-2 py-1 text-xs text-white hover:bg-amber-600"
                    >
                      Fire course {c.courseNumber}
                    </button>
                  ))}
                </div>
              ))}
              {tables.length === 0 && <p className="col-span-full text-sm text-secondary-500">No tables at this branch.</p>}
            </div>

            <h2 className="mb-2 font-semibold">
              Kitchen queue <span className="text-xs font-normal text-secondary-500">({stations.length} station{stations.length === 1 ? "" : "s"})</span>
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between text-xs text-secondary-500">
                    <span>{ticket.station.name}</span>
                    <span>Course {ticket.courseNumber}</span>
                  </div>
                  {(ticket.tab?.table.label ?? ticket.sale?.restaurantTable?.table.label) && (
                    <p className="mt-1 text-sm font-semibold">{ticket.tab?.table.label ?? ticket.sale?.restaurantTable?.table.label}</p>
                  )}
                  <p className="mt-1 text-xs uppercase tracking-wide text-secondary-500">{ticket.status.replace("_", " ")}</p>
                  {ticket.lines.map((line) => (
                    <p key={line.id} className={`mt-1 text-sm ${line.voidedAt ? "text-secondary-500 line-through" : ""}`}>
                      {line.quantity}x {line.variant.product.name}
                      {line.voidedAt ? " - voided" : ""}
                    </p>
                  ))}
                </div>
              ))}
              {tickets.length === 0 && <p className="col-span-full text-sm text-secondary-500">No active tickets.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
