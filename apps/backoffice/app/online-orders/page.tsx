"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { DeliveryBox } from "../../components/delivery-box";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { Badge, Button, EmptyState, LoadingState } from "@zaroda/ui";

type OrderStatus = "PENDING_PAYMENT" | "PAID" | "ACCEPTED" | "READY" | "COMPLETED" | "CANCELLED" | "EXPIRED";

interface OrderLine {
  id: string;
  productName: string;
  variantSku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface OnlineOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfilmentType: "PICKUP" | "DELIVERY";
  deliveryAddress: string | null;
  buyerNote: string | null;
  buyerName: string | null;
  buyerPhone: string;
  subtotal: number;
  amountDue: number;
  commissionAmount: number | null;
  mpesaReceiptNumber: string | null;
  lastPaymentError: string | null;
  paidAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  lines: OrderLine[];
}

const TABS: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: "new", label: "To accept", statuses: ["PAID"] },
  { key: "active", label: "In progress", statuses: ["ACCEPTED", "READY"] },
  { key: "unpaid", label: "Awaiting payment", statuses: ["PENDING_PAYMENT"] },
  { key: "done", label: "Completed", statuses: ["COMPLETED"] },
  { key: "closed", label: "Cancelled / expired", statuses: ["CANCELLED", "EXPIRED"] },
];

const STATUS_BADGE: Record<OrderStatus, { label: string; variant: "primary" | "success" | "warning" | "error" | "neutral" }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", variant: "neutral" },
  PAID: { label: "Paid - accept it", variant: "warning" },
  ACCEPTED: { label: "Preparing", variant: "primary" },
  READY: { label: "Ready", variant: "primary" },
  COMPLETED: { label: "Completed", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "error" },
  EXPIRED: { label: "Expired", variant: "neutral" },
};

const POLL_MS = 30_000;

function formatQty(q: number) {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, "");
}

/**
 * The business's online order queue. Buyers have already paid (into the
 * business's own TUMA account) by the time an order reaches "To accept".
 * Accepting deducts the stock; completing is when Zaroda's commission
 * becomes owed. Polls so new orders appear without a refresh.
 */
export default function OnlineOrdersPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("new");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders(await apiGet<OnlineOrder[]>("/online-orders"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load online orders.");
    } finally {
      setLoading(false);
    }
  }, []);

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
    setSessionState(s);
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [router, load]);

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, orders.filter((o) => t.statuses.includes(o.status)).length])),
    [orders],
  );
  const visible = orders.filter((o) => TABS.find((t) => t.key === tab)!.statuses.includes(o.status));

  async function act(order: OnlineOrder, action: "accept" | "ready" | "complete" | "cancel" | "confirm-payment") {
    let body: unknown = {};
    if (action === "confirm-payment") {
      // The shop's own money, so its word is enough - but the M-Pesa code is kept so the payment can be traced.
      const receipt = prompt(`Mark ${order.orderNumber} as paid.

Only do this if you can see the M-Pesa payment of KES ${order.amountDue} (in your M-Pesa messages or the Tuma portal).

Enter the M-Pesa confirmation code, e.g. SJK1ABC2DE:`);
      if (!receipt || !/^[A-Za-z0-9]{8,20}$/.test(receipt.trim())) {
        if (receipt) setActionError("That doesn't look like an M-Pesa confirmation code (8-20 letters and numbers).");
        return;
      }
      body = { receipt: receipt.trim() };
    }
    if (action === "cancel") {
      const warning = order.paidAt
        ? `The buyer paid KES ${order.amountDue}. If you cancel, you must refund them yourself via M-Pesa.\n\nReason for cancelling:`
        : "Reason for cancelling:";
      const reason = prompt(warning);
      if (!reason || reason.trim().length < 3) return;
      body = { reason: reason.trim() };
    }
    setBusyId(order.id);
    setActionError(null);
    setNotice(null);
    try {
      const result = await apiPost<OnlineOrder & { refundDue?: number }>(`/online-orders/${order.id}/${action}`, body);
      setOrders((current) => current.map((o) => (o.id === order.id ? result : o)));
      if (result.refundDue) {
        setNotice(`Order ${order.orderNumber} cancelled. Remember to refund KES ${result.refundDue} to ${order.buyerPhone}.`);
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? `${order.orderNumber}: ${err.message}` : "Could not update the order.");
      void load();
    } finally {
      setBusyId(null);
    }
  }

  if (!session) return null;

  const canCancel = session.role === "MANAGER" || session.role === "OWNER";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Online Orders</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/settings/online-shop/riders" className="text-primary-600 hover:underline">
              My riders
            </Link>
            <Link href="/settings/online-shop" className="text-primary-600 hover:underline">
              Shop settings
            </Link>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                tab === t.key ? "border-primary-600 font-semibold" : "border-transparent text-secondary-500 hover:text-foreground"
              }`}
            >
              {t.label}
              {counts[t.key] > 0 && <span className="ml-1.5 rounded-full bg-secondary-500/10 px-1.5 text-xs text-secondary-700">{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        {loading && <LoadingState label="Loading orders..." />}
        {error && <p className="text-sm text-error-600">{error}</p>}
        {actionError && <p className="text-sm text-error-600">{actionError}</p>}
        {notice && <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-700">{notice}</p>}

        {!loading && !error && visible.length === 0 && (
          <EmptyState
            title="Nothing here"
            description={tab === "new" ? "Paid orders waiting for you to accept will show up here. This page refreshes every 30 seconds." : "No orders in this list."}
          />
        )}

        <div className="space-y-3">
          {visible.map((order) => {
            const badge = STATUS_BADGE[order.status];
            const busy = busyId === order.id;
            return (
              <div key={order.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">{order.orderNumber}</span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      <Badge variant="neutral">{order.fulfilmentType === "PICKUP" ? "Pickup" : "Delivery"}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-secondary-500">{new Date(order.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold">KES {order.amountDue.toLocaleString()}</p>
                    {order.mpesaReceiptNumber && <p className="text-xs text-secondary-500">M-Pesa {order.mpesaReceiptNumber}</p>}
                  </div>
                </div>

                <div className="mt-3 text-sm">
                  <p>
                    {order.buyerName ?? "Buyer"} ·{" "}
                    <a href={`tel:+${order.buyerPhone}`} className="text-primary-600 hover:underline">
                      +{order.buyerPhone}
                    </a>
                  </p>
                  {order.deliveryAddress && <p className="text-secondary-600">Deliver to: {order.deliveryAddress}</p>}
                  {order.buyerNote && <p className="text-secondary-600">Note: {order.buyerNote}</p>}
                  {order.lastPaymentError && order.status !== "PENDING_PAYMENT" && (
                    // A payment that arrived after the order was cancelled/expired, or didn't match - check TUMA and refund if needed.
                    <p className="text-warning-700">Payment issue: {order.lastPaymentError}</p>
                  )}
                  {order.cancelReason && (
                    <p className="text-error-600">
                      Cancelled by {order.cancelledBy === "BUYER" ? "buyer" : "shop"}: {order.cancelReason}
                    </p>
                  )}
                </div>

                <table className="mt-3 w-full text-left text-sm">
                  <tbody>
                    {order.lines.map((l) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-1.5">
                          {formatQty(l.quantity)} × {l.productName} <span className="text-secondary-500">({l.variantSku})</span>
                        </td>
                        <td className="py-1.5 text-right font-mono">KES {l.lineTotal.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {order.fulfilmentType === "DELIVERY" && ["ACCEPTED", "READY", "COMPLETED"].includes(order.status) && (
                  <DeliveryBox orderId={order.id} canManage={session.role === "MANAGER" || session.role === "OWNER"} />
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {order.status === "PAID" && (
                    <Button size="sm" onClick={() => void act(order, "accept")} disabled={busy}>
                      Accept order
                    </Button>
                  )}
                  {order.status === "ACCEPTED" && (
                    <Button size="sm" onClick={() => void act(order, "ready")} disabled={busy}>
                      {order.fulfilmentType === "PICKUP" ? "Ready for pickup" : "Packed - ready for the rider"}
                    </Button>
                  )}
                  {(order.status === "ACCEPTED" || order.status === "READY") && (
                    <Button size="sm" variant={order.status === "READY" ? "primary" : "outline"} onClick={() => void act(order, "complete")} disabled={busy}>
                      {order.fulfilmentType === "PICKUP" ? "Collected" : "Mark delivered"}
                    </Button>
                  )}
                  {canCancel && (order.status === "PENDING_PAYMENT" || order.status === "EXPIRED") && (
                    <Button size="sm" variant="outline" onClick={() => void act(order, "confirm-payment")} disabled={busy}>
                      Mark as paid
                    </Button>
                  )}
                  {canCancel && ["PENDING_PAYMENT", "PAID", "ACCEPTED", "READY"].includes(order.status) && (
                    <Button size="sm" variant="ghost" onClick={() => void act(order, "cancel")} disabled={busy}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
