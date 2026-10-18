"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, Button, EmptyState, Input, LoadingState, Modal, ModalFooter } from "@zaroda/ui";

interface HotelRow {
  organizationId: string;
  organizationName: string;
  bookings: number;
  paidBookings: number;
  byStatus: Record<string, number>;
  noShow: number;
  cancelled: number;
  noShowRate: number;
  cancelledRate: number;
  depositsReceived: number;
  depositsToRefund: number;
  stayValue: number;
  commissionRecorded: number;
  flaggedPayments: number;
  watch: string | null;
  contactPhone: string | null;
  whatsapp: string | null;
  ownerEmail: string | null;
  hotelBlockedReason: string | null;
}
interface RecentBooking {
  id: string;
  organizationName: string;
  bookingNumber: string;
  status: string;
  guestName: string;
  guestPhone: string;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  total: number;
  depositAmount: number;
  paid: boolean;
  note: string | null;
  createdAt: string;
}
interface HotelOverview {
  days: number;
  summary: { hotels: number; bookings: number; depositsReceived: number; commissionRecorded: number; onWatch: number; flaggedPayments: number };
  hotels: HotelRow[];
  recent: RecentBooking[];
}
interface RestaurantRow {
  organizationId: string;
  organizationName: string;
  orders: number;
  paidOrders: number;
  completedOrders: number;
  sales: number;
  refundsOwed: number;
  commissionRecorded: number;
  notPaid: number;
  stuck: number;
  flagged: number;
  contactPhone: string | null;
  whatsapp: string | null;
  ownerEmail: string | null;
  hotelBlockedReason: string | null;
  tableOrderingBlockedReason: string | null;
}
interface Attention {
  id: string;
  organizationName: string;
  orderNumber: string;
  tableLabel: string | null;
  amountDue: number;
  paidAt: string | null;
  problem: string;
}
interface OrderOverview {
  days: number;
  summary: { restaurants: number; orders: number; sales: number; commissionRecorded: number; needAttention: number };
  restaurants: RestaurantRow[];
  attention: Attention[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE");
const STATUS_LABEL: Record<string, string> = { PENDING_PAYMENT: "Waiting for deposit", CONFIRMED: "Confirmed", CHECKED_IN: "In the house", CHECKED_OUT: "Checked out", CANCELLED: "Cancelled", EXPIRED: "Expired", NO_SHOW: "No-show" };

/** Call, WhatsApp and email links for a business, so a problem can be raised in one tap. */
function ContactLinks({ phone, whatsapp, email }: { phone: string | null; whatsapp: string | null; email: string | null }) {
  const link = "text-xs underline";
  if (!phone && !email) return <span className="text-xs text-secondary-500">No contact details</span>;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {phone && (
        <a href={`tel:${whatsapp ? `+${whatsapp}` : phone}`} className={link}>
          Call {phone}
        </a>
      )}
      {whatsapp && (
        <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className={link}>
          WhatsApp
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={link}>
          Email
        </a>
      )}
    </div>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
  <div className="rounded-lg border border-border bg-surface p-3">
    <p className="text-xs text-secondary-500">{label}</p>
    <p className={`text-lg font-bold ${tone ?? ""}`}>{value}</p>
  </div>
);

/**
 * How the restaurant and hotel side is going, across all businesses. Read-only: hotels whose paid bookings too often end
 * as a no-show or a cancellation are flagged (that is how a deposit can be kept, or commission dodged), deposits owed
 * back to guests are totalled, and table orders that were paid but never reached a kitchen are listed so someone can fix them.
 */
export default function HospitalityPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"hotels" | "orders">("hotels");
  const [days, setDays] = useState(90);
  const [hotels, setHotels] = useState<HotelOverview | null>(null);
  const [orders, setOrders] = useState<OrderOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<{ kind: "hotel" | "ordering"; organizationId: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    setError(null);
    const load = tab === "hotels" ? apiGet<HotelOverview>(`/platform-admin/hotel-overview?days=${days}`).then(setHotels) : apiGet<OrderOverview>(`/platform-admin/table-order-overview?days=${days}`).then(setOrders);
    load.catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this overview."));
  }, [session, tab, days]);

  async function reload() {
    if (tab === "hotels") setHotels(await apiGet<HotelOverview>(`/platform-admin/hotel-overview?days=${days}`));
    else setOrders(await apiGet<OrderOverview>(`/platform-admin/table-order-overview?days=${days}`));
  }

  const WORDS = {
    hotel: { path: "hotel", off: "Take off marketplace", offDone: "is now off the marketplace. Its existing bookings are untouched.", onDone: "can list rooms on the marketplace again - it switches its room types back on itself.", failOff: "Could not take the hotel off the marketplace.", failOn: "Could not restore the hotel." },
    ordering: { path: "table-ordering", off: "Switch off table ordering", offDone: "table ordering is now switched off. Orders already placed carry on.", onDone: "table ordering is on again.", failOff: "Could not switch table ordering off.", failOn: "Could not switch table ordering back on." },
  } as const;

  async function takeOff() {
    if (!target) return;
    const w = WORDS[target.kind];
    setBusy(true);
    setModalError(null);
    try {
      await apiPost(`/platform-admin/organizations/${target.organizationId}/${w.path}/block`, { reason: reason.trim() });
      setNotice(`${target.name}: ${w.offDone}`);
      setTarget(null);
      setReason("");
      await reload();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : w.failOff);
    } finally {
      setBusy(false);
    }
  }

  async function restore(kind: "hotel" | "ordering", organizationId: string, name: string) {
    const w = WORDS[kind];
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/platform-admin/organizations/${organizationId}/${w.path}/unblock`, {});
      setNotice(`${name}: ${w.onDone}`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : w.failOn);
    }
  }

  if (!session) return null;
  const data = tab === "hotels" ? hotels : orders;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold">Hotels &amp; table orders</h1>
        <p className="mt-1 text-sm text-secondary-500">How bookings and table orders are going across your businesses.</p>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          {(
            [
              ["hotels", "Hotel bookings"],
              ["orders", "Table orders"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); setDays(key === "hotels" ? 90 : 30); }} className={`rounded-full border px-3 py-1 ${tab === key ? "border-amber-400 bg-amber-400/10 font-medium" : "border-border"}`}>
              {label}
            </button>
          ))}
          <span className="ml-auto text-secondary-500">Last</span>
          {[7, 30, 90, 365].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-full border px-3 py-1 ${days === d ? "border-amber-400 bg-amber-400/10 font-medium" : "border-border"}`}>
              {d === 365 ? "year" : `${d} days`}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 rounded-md bg-error-50 p-3 text-sm text-error-700">{error}</p>}
        {notice && <p className="mt-4 rounded-md bg-success-50 p-3 text-sm text-success-700">{notice}</p>}
        {!data && !error && <div className="mt-6"><LoadingState label="Loading..." /></div>}

        {tab === "hotels" && hotels && (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Hotels with bookings" value={hotels.summary.hotels} />
              <Stat label="Bookings" value={hotels.summary.bookings} />
              <Stat label="Deposits received" value={kes(hotels.summary.depositsReceived)} />
              <Stat label="Commission recorded" value={kes(hotels.summary.commissionRecorded)} />
              <Stat label="On watch" value={hotels.summary.onWatch} tone={hotels.summary.onWatch > 0 ? "text-error-600" : ""} />
              <Stat label="Payment notes" value={hotels.summary.flaggedPayments} tone={hotels.summary.flaggedPayments > 0 ? "text-warning-700" : ""} />
            </div>

            {hotels.hotels.length === 0 ? (
              <EmptyState title="No hotel bookings in this period" description="They appear here as guests book rooms on the marketplace." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface text-xs uppercase text-secondary-500">
                    <tr>
                      <th className="p-3">Hotel</th>
                      <th className="p-3 text-right">Bookings</th>
                      <th className="p-3 text-right">Paid</th>
                      <th className="p-3 text-right">No-shows</th>
                      <th className="p-3 text-right">Cancelled</th>
                      <th className="p-3 text-right">Deposits received</th>
                      <th className="p-3 text-right">To refund</th>
                      <th className="p-3 text-right">Commission</th>
                      <th className="p-3">Notes</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {hotels.hotels.map((h) => (
                      <tr key={h.organizationId} className="border-t border-border align-top">
                        <td className="p-3 font-medium">
                          {h.organizationName}
                          {h.watch && <span className="mt-1 block max-w-[18rem] text-xs font-normal text-error-600">{h.watch}</span>}
                        </td>
                        <td className="p-3 text-right">{h.bookings}</td>
                        <td className="p-3 text-right">{h.paidBookings}</td>
                        <td className="p-3 text-right">
                          {h.noShow} <span className="text-xs text-secondary-500">({h.noShowRate}%)</span>
                        </td>
                        <td className="p-3 text-right">
                          {h.cancelled} <span className="text-xs text-secondary-500">({h.cancelledRate}%)</span>
                        </td>
                        <td className="p-3 text-right font-mono">{kes(h.depositsReceived)}</td>
                        <td className="p-3 text-right font-mono">{h.depositsToRefund > 0 ? kes(h.depositsToRefund) : "-"}</td>
                        <td className="p-3 text-right font-mono">{kes(h.commissionRecorded)}</td>
                        <td className="p-3">
                          {h.watch && <Badge variant="error">On watch</Badge>} {h.flaggedPayments > 0 && <Badge variant="warning">{h.flaggedPayments} payment note{h.flaggedPayments === 1 ? "" : "s"}</Badge>}
                          {h.hotelBlockedReason && (
                            <>
                              <Badge variant="neutral">Off the marketplace</Badge>
                              <span className="mt-1 block max-w-[14rem] text-xs text-secondary-500">{h.hotelBlockedReason}</span>
                            </>
                          )}
                        </td>
                        <td className="p-3">
                          <ContactLinks phone={h.contactPhone} whatsapp={h.whatsapp} email={h.ownerEmail} />
                        </td>
                        <td className="whitespace-nowrap p-3 text-right">
                          {h.hotelBlockedReason ? (
                            <Button size="sm" variant="secondary" onClick={() => void restore("hotel", h.organizationId, h.organizationName)}>
                              Restore
                            </Button>
                          ) : (
                            <Button size="sm" variant="danger" onClick={() => { setTarget({ kind: "hotel", organizationId: h.organizationId, name: h.organizationName }); setReason(""); setModalError(null); }}>
                              Take off marketplace
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {hotels.recent.length > 0 && (
              <div>
                <h2 className="mb-2 font-semibold">Latest bookings</h2>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface text-xs uppercase text-secondary-500">
                      <tr>
                        <th className="p-3">Booking</th>
                        <th className="p-3">Hotel</th>
                        <th className="p-3">Guest</th>
                        <th className="p-3">Stay</th>
                        <th className="p-3 text-right">Total</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hotels.recent.map((b) => (
                        <tr key={b.id} className="border-t border-border align-top">
                          <td className="p-3">
                            <span className="font-mono text-xs">{b.bookingNumber}</span>
                            <span className="block text-xs text-secondary-500">{day(b.createdAt)}</span>
                          </td>
                          <td className="p-3">
                            {b.organizationName}
                            <span className="block text-xs text-secondary-500">{b.roomTypeName}</span>
                          </td>
                          <td className="p-3">
                            {b.guestName}
                            <span className="block font-mono text-xs text-secondary-500">{b.guestPhone}</span>
                          </td>
                          <td className="p-3 text-xs">
                            {b.checkIn} to {b.checkOut}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {kes(b.total)}
                            <span className="block text-xs text-secondary-500">deposit {kes(b.depositAmount)}{b.paid ? " paid" : ""}</span>
                          </td>
                          <td className="p-3">
                            <Badge variant={b.status === "CANCELLED" || b.status === "NO_SHOW" ? "error" : b.status === "CHECKED_OUT" || b.status === "CONFIRMED" || b.status === "CHECKED_IN" ? "success" : "neutral"}>{STATUS_LABEL[b.status] ?? b.status}</Badge>
                            {b.note && <span className="block max-w-[14rem] text-xs text-secondary-500">{b.note}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "orders" && orders && (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Restaurants with table orders" value={orders.summary.restaurants} />
              <Stat label="Table orders" value={orders.summary.orders} />
              <Stat label="Sales" value={kes(orders.summary.sales)} />
              <Stat label="Commission recorded" value={kes(orders.summary.commissionRecorded)} />
              <Stat label="Need attention" value={orders.summary.needAttention} tone={orders.summary.needAttention > 0 ? "text-error-600" : ""} />
            </div>

            {orders.attention.length > 0 && (
              <div>
                <h2 className="mb-2 font-semibold text-error-600">Needs attention</h2>
                <div className="overflow-x-auto rounded-lg border border-error-600/40">
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {orders.attention.map((a) => (
                        <tr key={a.id} className="border-t border-border first:border-t-0">
                          <td className="p-3">
                            <span className="font-mono text-xs">{a.orderNumber}</span>
                            <span className="block text-xs text-secondary-500">{a.tableLabel ?? "table"}</span>
                          </td>
                          <td className="p-3">{a.organizationName}</td>
                          <td className="p-3 font-mono">{kes(a.amountDue)}</td>
                          <td className="p-3 text-xs">{a.problem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {orders.restaurants.length === 0 ? (
              <EmptyState title="No table orders in this period" description="They appear here once diners start ordering from their tables." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface text-xs uppercase text-secondary-500">
                    <tr>
                      <th className="p-3">Restaurant</th>
                      <th className="p-3 text-right">Orders</th>
                      <th className="p-3 text-right">Paid</th>
                      <th className="p-3 text-right">Completed</th>
                      <th className="p-3 text-right">Not paid</th>
                      <th className="p-3 text-right">Sales</th>
                      <th className="p-3 text-right">Refunds owed</th>
                      <th className="p-3 text-right">Commission</th>
                      <th className="p-3">Notes</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.restaurants.map((r) => (
                      <tr key={r.organizationId} className="border-t border-border">
                        <td className="p-3 font-medium">{r.organizationName}</td>
                        <td className="p-3 text-right">{r.orders}</td>
                        <td className="p-3 text-right">{r.paidOrders}</td>
                        <td className="p-3 text-right">{r.completedOrders}</td>
                        <td className="p-3 text-right">{r.notPaid}</td>
                        <td className="p-3 text-right font-mono">{kes(r.sales)}</td>
                        <td className="p-3 text-right font-mono">{r.refundsOwed > 0 ? kes(r.refundsOwed) : "-"}</td>
                        <td className="p-3 text-right font-mono">{kes(r.commissionRecorded)}</td>
                        <td className="p-3">
                          {r.stuck > 0 && <Badge variant="error">{r.stuck} stuck</Badge>} {r.flagged > 0 && <Badge variant="warning">{r.flagged} payment mismatch</Badge>}
                          {r.tableOrderingBlockedReason && (
                            <>
                              <Badge variant="neutral">Ordering off</Badge>
                              <span className="mt-1 block max-w-[14rem] text-xs text-secondary-500">{r.tableOrderingBlockedReason}</span>
                            </>
                          )}
                        </td>
                        <td className="p-3">
                          <ContactLinks phone={r.contactPhone} whatsapp={r.whatsapp} email={r.ownerEmail} />
                        </td>
                        <td className="whitespace-nowrap p-3 text-right">
                          {r.tableOrderingBlockedReason ? (
                            <Button size="sm" variant="secondary" onClick={() => void restore("ordering", r.organizationId, r.organizationName)}>
                              Switch on
                            </Button>
                          ) : (
                            <Button size="sm" variant="danger" onClick={() => { setTarget({ kind: "ordering", organizationId: r.organizationId, name: r.organizationName }); setReason(""); setModalError(null); }}>
                              Switch off ordering
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <Modal open={!!target} onClose={() => setTarget(null)} title={target ? `${WORDS[target.kind].off} - ${target.name}` : ""}>
          {target && (
            <div className="space-y-3">
              {target.kind === "hotel" ? (
                <p className="text-sm">
                  The hotel disappears from the Hotels page straight away and cannot take new bookings, and it cannot list rooms again until you restore it. Bookings it already has are not touched - those guests have paid deposits, so contact the hotel about them.
                </p>
              ) : (
                <p className="text-sm">
                  The table QR codes stop taking orders straight away: diners who scan them are told ordering is off. Orders already paid for carry on to the kitchen as normal, and the restaurant is shown your reason. Switch it back on whenever the problem is sorted.
                </p>
              )}
              <div>
                <label className="mb-1.5 block text-sm text-secondary-500">Reason (the business sees this)</label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={target.kind === "hotel" ? "e.g. Repeated complaints about cancelled bookings" : "e.g. Orders are not reaching the kitchen"} />
              </div>
              {modalError && <p className="text-sm text-error-600">{modalError}</p>}
            </div>
          )}
          <ModalFooter>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void takeOff()} disabled={busy || reason.trim().length < 3}>
              {busy ? "Working..." : target ? WORDS[target.kind].off : ""}
            </Button>
          </ModalFooter>
        </Modal>
      </main>
    </div>
  );
}
