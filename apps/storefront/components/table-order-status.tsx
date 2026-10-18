"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ChefHat, CircleDashed, Clock, Receipt, Utensils } from "lucide-react";
import { ApiError, checkTableOrder, getTableOrder, retryTableOrder } from "../lib/api";
import { displayPhone, formatQty, kes } from "../lib/format";
import type { KitchenStage, TableOrder } from "../lib/types";

const ORDERS_KEY = "zaroda_table_orders";
const POLL_MS = 4_000;

function savedToken(id: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(ORDERS_KEY) ?? "{}") as Record<string, string>)[id] ?? null;
  } catch {
    return null;
  }
}

const STAGES: { stage: KitchenStage; label: string; hint: string }[] = [
  { stage: "SENT", label: "Sent to the kitchen", hint: "The kitchen has your order." },
  { stage: "PREPARING", label: "Being prepared", hint: "The cooks are on it." },
  { stage: "READY", label: "Ready", hint: "Your food is on its way to the table." },
  { stage: "SERVED", label: "Served", hint: "Enjoy your meal!" },
];
const STAGE_INDEX: Record<KitchenStage, number> = { WAITING: -1, SENT: 0, PREPARING: 1, READY: 2, SERVED: 3 };

/**
 * The page a diner lands on after ordering from a table: first the prompt to pay, then a live view of the kitchen
 * (it refreshes by itself with plain reads - nothing here costs the restaurant anything).
 */
export default function TableOrderStatus({ orderId }: { orderId: string }) {
  const params = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [order, setOrder] = useState<TableOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitedLong, setWaitedLong] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    setToken(params.get("k") ?? savedToken(orderId));
  }, [params, orderId]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setOrder(await getTableOrder(orderId, token));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : "Could not refresh - check your connection.");
    }
  }, [orderId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep watching until the order is finished one way or another.
  const finished = order ? ["COMPLETED", "CANCELLED", "EXPIRED"].includes(order.status) : false;
  useEffect(() => {
    if (!token || finished || notFound) return;
    const timer = setInterval(() => {
      void load();
      if (Date.now() - startedAt.current > 45_000) setWaitedLong(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [token, finished, notFound, load]);

  async function sendAgain() {
    if (!token) return;
    setBusy(true);
    setHint(null);
    try {
      setOrder(await retryTableOrder(orderId, token));
      startedAt.current = Date.now();
      setWaitedLong(false);
      setHint("We sent the M-Pesa prompt again - check your phone.");
    } catch (err) {
      setHint(err instanceof ApiError ? err.message : "Could not send it again.");
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    if (!token) return;
    setBusy(true);
    setHint(null);
    try {
      const result = await checkTableOrder(orderId, token);
      setOrder(result);
      if (result.checkResult === "not-paid-yet") setHint("Not received yet. If you have entered your PIN, wait a moment and try again.");
      if (result.checkResult === "unavailable") setHint("We could not check just now. Please ask a waiter to confirm your payment.");
    } catch (err) {
      setHint(err instanceof ApiError ? err.message : "Could not check the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (notFound || (token === null && order === null && typeof window !== "undefined" && !params.get("k") && !savedToken(orderId))) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-10 text-center">
        <h1 className="text-xl font-semibold">We can&apos;t find that order</h1>
        <p className="text-secondary-600">Open this page from the same phone that placed the order, or ask a waiter for help.</p>
      </div>
    );
  }
  if (!order) return <p className="py-10 text-center text-secondary-500">{error ?? "Loading your order..."}</p>;

  const stageIndex = order.status === "COMPLETED" ? 3 : STAGE_INDEX[order.kitchen.stage];
  const waitingToPay = order.status === "PENDING_PAYMENT";
  const cancelled = order.status === "CANCELLED";
  const expired = order.status === "EXPIRED";

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="rounded-xl bg-primary-600 px-5 py-4 text-white">
        <p className="text-sm text-primary-50">{order.shop.name}</p>
        <h1 className="text-xl font-bold">
          {order.tableLabel ?? "Your table"} - order {order.orderNumber}
        </h1>
      </div>

      {waitingToPay && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Clock size={18} aria-hidden /> Check your phone and enter your M-Pesa PIN
          </p>
          <p className="text-sm text-secondary-600">
            We sent a prompt for <strong>{kes(order.amountDue)}</strong> to {displayPhone(order.paymentPhone)}. This page updates by itself the moment it is paid.
          </p>
          {order.lastPaymentError && <p className="rounded-md bg-warning-50 p-2 text-sm text-warning-700">{order.lastPaymentError}</p>}
          {hint && <p className="text-sm text-secondary-600">{hint}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void sendAgain()} disabled={busy} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">
              {waitedLong || order.lastPaymentError ? "Send the prompt again" : "Didn't get it? Send again"}
            </button>
            {waitedLong && (
              <button onClick={() => void checkNow()} disabled={busy} className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                I&apos;ve paid - check now
              </button>
            )}
          </div>
        </div>
      )}

      {expired && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <p className="font-semibold">The payment didn&apos;t come through in time</p>
          <p className="text-sm text-secondary-600">Nothing was charged for this order. Scan the QR code on your table to order again.</p>
        </div>
      )}

      {cancelled && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <p className="font-semibold">This order was cancelled</p>
          {order.cancelReason && <p className="text-sm text-secondary-600">{order.cancelReason}</p>}
          {order.cancelledBy === "BUSINESS" && order.mpesaReceiptNumber && (
            <p className="text-sm text-secondary-600">The restaurant will refund {kes(order.amountDue)} to your M-Pesa. Please ask a waiter if you don&apos;t receive it.</p>
          )}
        </div>
      )}

      {!waitingToPay && !cancelled && !expired && (
        <ol className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <li className="flex items-start gap-3">
            <CheckCircle2 size={22} className="mt-0.5 text-success-600" aria-hidden />
            <span>
              <span className="block font-medium">Paid {kes(order.amountDue)}</span>
              {order.mpesaReceiptNumber && <span className="block text-xs text-secondary-500">M-Pesa receipt {order.mpesaReceiptNumber}</span>}
            </span>
          </li>
          {STAGES.map((step, i) => {
            const reached = stageIndex >= i;
            const current = stageIndex === i && order.status !== "COMPLETED";
            const Icon = reached ? (step.stage === "PREPARING" ? ChefHat : step.stage === "SERVED" ? Utensils : CheckCircle2) : CircleDashed;
            return (
              <li key={step.stage} className="flex items-start gap-3">
                <Icon size={22} className={`mt-0.5 ${reached ? "text-success-600" : "text-secondary-400"}`} aria-hidden />
                <span>
                  <span className={`block font-medium ${reached ? "" : "text-secondary-500"}`}>{step.label}</span>
                  {current && <span className="block text-xs text-secondary-500">{step.hint}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Receipt size={16} aria-hidden /> What you ordered
        </h2>
        <ul className="space-y-1 text-sm">
          {order.lines.map((l) => (
            <li key={l.id}>
              <div className="flex justify-between gap-2">
                <span>
                  {formatQty(l.quantity)} x {l.productName}
                </span>
                <span className="font-mono">{kes(l.lineTotal)}</span>
              </div>
              {l.note && <p className="text-xs text-secondary-500">{l.note}</p>}
            </li>
          ))}
        </ul>
        {order.buyerNote && <p className="text-xs text-secondary-500">Note: {order.buyerNote}</p>}
        {order.tipAmount ? (
          <p className="flex justify-between border-t border-border pt-2 text-sm text-secondary-600">
            <span>Tip for the staff</span>
            <span>{kes(order.tipAmount)}</span>
          </p>
        ) : null}
        <p className="flex justify-between border-t border-border pt-2 font-semibold">
          <span>Total</span>
          <span>{kes(order.amountDue)}</span>
        </p>
      </section>

      {error && <p className="text-center text-xs text-secondary-500">{error}</p>}
      <p className="text-center text-sm">
        <Link href={`/s/${order.shop.slug}`} className="text-primary-600 hover:underline">
          See {order.shop.name}
        </Link>
      </p>
    </div>
  );
}
