"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { ApiError, cancelOrder, checkOrderPayment, getOrder, payOrder } from "../lib/api";
import { displayPhone, formatQty, kes } from "../lib/format";
import type { Order } from "../lib/types";
import AuthForm from "./auth-form";
import DeliveryPanel from "./delivery-panel";
import OrderStatusBadge, { PROGRESS_STEPS, progressIndex } from "./order-status";
import { useStore } from "./store-provider";

// While the buyer is looking at the page, refresh often when we're waiting on their
// M-Pesa PIN, and occasionally while the shop works on the order. These are plain,
// free reads of OUR order - the payment itself arrives by M-Pesa's own notification.
const POLL_WAITING_PAYMENT_MS = 4_000;
const POLL_IN_PROGRESS_MS = 20_000;
// Only after this long without a confirmation do we offer the manual check (it costs the shop KES 1).
const SHOW_CHECK_AFTER_MS = 45_000;

export default function OrderDetail({ orderId }: { orderId: string }) {
  const { ready, buyer, token, signOut } = useStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryPhone, setRetryPhone] = useState("");
  const [canCheck, setCanCheck] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getOrder(token, orderId);
      setOrder(result);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signOut();
      else setError(err instanceof ApiError ? err.message : "Could not load this order.");
    }
  }, [token, orderId, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the page fresh until the order reaches a final state.
  useEffect(() => {
    if (!order) return;
    const final = ["COMPLETED", "CANCELLED", "EXPIRED"].includes(order.status);
    if (final) return;
    const delay = order.status === "PENDING_PAYMENT" ? POLL_WAITING_PAYMENT_MS : POLL_IN_PROGRESS_MS;
    timer.current = setTimeout(() => void load(), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [order, load]);

  useEffect(() => {
    if (order && !retryPhone) setRetryPhone(displayPhone(order.paymentPhone));
  }, [order, retryPhone]);

  // Offer "I've paid, check now" only after a wait.
  const waiting = order?.status === "PENDING_PAYMENT";
  useEffect(() => {
    if (!waiting) {
      setCanCheck(false);
      return;
    }
    const t = setTimeout(() => setCanCheck(true), SHOW_CHECK_AFTER_MS);
    return () => clearTimeout(t);
  }, [waiting]);

  async function checkNow() {
    if (!token || !order) return;
    setBusy(true);
    setActionError(null);
    setCheckMessage(null);
    try {
      const result = await checkOrderPayment(token, order.id);
      setOrder(result);
      if (result.checkResult === "not-paid-yet") setCheckMessage("We haven't received your payment yet. If you've just entered your PIN, give it a minute and try again.");
      if (result.checkResult === "unavailable") setCheckMessage("We couldn't check just now. If you've paid, the shop will confirm it - you can also contact them with your M-Pesa message.");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<Order>) {
    setBusy(true);
    setActionError(null);
    try {
      setOrder(await fn());
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="py-10 text-center text-secondary-500">Loading...</p>;

  if (!buyer || !token) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-lg border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold">Sign in to see this order</h1>
        <AuthForm />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-10 text-center">
        <p className="text-error-600">{error}</p>
        <Link href="/orders" className="text-primary-600 hover:underline">
          Back to my orders
        </Link>
      </div>
    );
  }

  if (!order) return <p className="py-10 text-center text-secondary-500">Loading your order...</p>;

  const progress = progressIndex(order.status);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href="/orders" className="text-sm text-primary-600 hover:underline">
          My orders
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Order {order.orderNumber}</h1>
          <OrderStatusBadge order={order} />
        </div>
        <p className="text-sm text-secondary-500">
          From{" "}
          <Link href={`/s/${order.shop.slug}`} className="text-primary-600 hover:underline">
            {order.shop.name}
          </Link>{" "}
          on {new Date(order.createdAt).toLocaleString("en-KE")}
        </p>
      </div>

      {waiting && (
        <section className="space-y-3 rounded-lg border border-warning-500 bg-warning-50 p-4 text-warning-900" aria-live="polite">
          <h2 className="font-semibold text-warning-700">Complete your payment</h2>
          <p className="text-sm">
            Check your phone <strong>{displayPhone(order.paymentPhone)}</strong> for an M-Pesa prompt for <strong>{kes(order.amountDue)}</strong> and enter your PIN. This page updates by itself once the payment goes through.
          </p>
          {order.lastPaymentError && <p className="text-sm text-error-700">{order.lastPaymentError}</p>}
          {order.lastPaymentError && /blacklist|blocked/i.test(order.lastPaymentError) && (
            <p className="rounded-md bg-warning-50 p-2 text-sm text-warning-900">
              M-Pesa has paused prompts to this number. <strong>Type a different M-Pesa number below</strong> (a friend&apos;s or another line of yours) and tap &quot;Send the prompt again&quot;, or try again later. Tapping the button again on this number will not help.
            </p>
          )}
          <p className="text-xs text-secondary-600">
            Your items are held until {new Date(order.paymentDeadline).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="retry-phone" className="block text-xs font-medium">
                M-Pesa number
              </label>
              <input
                id="retry-phone"
                type="tel"
                value={retryPhone}
                onChange={(e) => setRetryPhone(e.target.value)}
                className="mt-1 rounded-md border border-border bg-surface p-2 text-sm"
              />
            </div>
            <button
              onClick={() => void act(() => payOrder(token, order.id, retryPhone.trim()))}
              disabled={busy || !retryPhone.trim()}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {busy ? "Sending..." : "Send the prompt again"}
            </button>
            <button
              onClick={() => {
                if (confirm("Cancel this order?")) void act(() => cancelOrder(token, order.id));
              }}
              disabled={busy}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary-500/5"
            >
              Cancel order
            </button>
          </div>
          {canCheck && (
            <div className="border-t border-warning-500/40 pt-3">
              <p className="text-sm">Paid, but this page hasn't changed?</p>
              <button
                onClick={() => void checkNow()}
                disabled={busy}
                className="mt-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-secondary-500/5 disabled:opacity-50"
              >
                {busy ? "Checking..." : "I've paid - check now"}
              </button>
              {checkMessage && <p className="mt-2 text-sm text-secondary-700">{checkMessage}</p>}
            </div>
          )}
          {actionError && <p className="text-sm text-error-600">{actionError}</p>}
        </section>
      )}

      {order.status === "EXPIRED" && (
        <p className="rounded-md border border-border bg-surface p-4 text-sm">
          This order wasn&apos;t paid in time, so the items were released. If you did pay, contact the shop with your M-Pesa message and this order number.{" "}
          <Link href={`/s/${order.shop.slug}`} className="text-primary-600 hover:underline">
            Order again
          </Link>
        </p>
      )}

      {order.status === "CANCELLED" && (
        <p className="rounded-md border border-error-500 bg-error-50 p-4 text-sm text-error-700">
          Cancelled{order.cancelledBy === "BUYER" ? " by you" : " by the shop"}
          {order.cancelReason && order.cancelledBy !== "BUYER" ? `: ${order.cancelReason}` : ""}.
          {order.mpesaReceiptNumber && " The shop will refund your payment to your M-Pesa."}
        </p>
      )}

      {progress >= 0 && (
        <ol className="flex items-center justify-between gap-1" aria-label="Order progress">
          {PROGRESS_STEPS.map((step, i) => (
            <li key={step.status} className="flex flex-1 flex-col items-center gap-1 text-center text-xs">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full ${i <= progress ? "bg-success-600 text-white" : "bg-secondary-500/10 text-secondary-400"}`}
              >
                {i <= progress ? <Check size={14} aria-hidden /> : i + 1}
              </span>
              <span className={i <= progress ? "font-medium" : "text-secondary-500"}>
                {step.status === "READY" ? (order.fulfilmentType === "PICKUP" ? "Ready" : "On the way") : step.label}
              </span>
            </li>
          ))}
        </ol>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Items</h2>
        <ul className="divide-y divide-border text-sm">
          {order.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3 py-2">
              <span>
                {formatQty(l.quantity)} x {l.productName}
                {/* The product code is only worth showing when two lines have the same name (e.g. two sizes of one product). */}
                {order.lines.filter((other) => other.productName === l.productName).length > 1 && <span className="text-secondary-500"> ({l.variantSku})</span>}
              </span>
              <span className="font-mono">{kes(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        {order.convenienceFee > 0 && (
          <div className="space-y-1 border-t border-border pt-3 text-sm text-secondary-600">
            <div className="flex justify-between">
              <span>Items</span>
              <span className="font-mono">{kes(order.amountDue - order.convenienceFee)}</span>
            </div>
            <div className="flex justify-between">
              <span>Convenience fee</span>
              <span className="font-mono">{kes(order.convenienceFee)}</span>
            </div>
          </div>
        )}
        <div className={`flex justify-between pt-3 font-bold ${order.convenienceFee > 0 ? "" : "border-t border-border"}`}>
          <span>Total</span>
          <span>{kes(order.amountDue)}</span>
        </div>
        {order.mpesaReceiptNumber && <p className="text-xs text-secondary-500">Paid by M-Pesa, receipt {order.mpesaReceiptNumber}</p>}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="mb-1 font-semibold">{order.fulfilmentType === "PICKUP" ? "Pickup" : "Delivery"}</h2>
        {order.fulfilmentType === "DELIVERY" && order.deliveryAddress && <p>{order.deliveryAddress}</p>}
        {order.fulfilmentType === "PICKUP" && <p className="text-secondary-600">Collect from {order.shop.name}. Quote order number {order.orderNumber}.</p>}
        {order.buyerNote && <p className="mt-1 text-secondary-600">Your note: {order.buyerNote}</p>}
      </section>

      {order.fulfilmentType === "DELIVERY" && ["ACCEPTED", "READY", "COMPLETED"].includes(order.status) && token && (
        <DeliveryPanel token={token} orderId={order.id} onUnauthorized={signOut} />
      )}
    </div>
  );
}
