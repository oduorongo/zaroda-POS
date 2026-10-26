"use client";

import { PasswordInput } from "@zaroda/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api";
import { kes } from "../lib/format";
import {
  schoolAcceptQuote,
  schoolCancelOrder,
  schoolDeclineQuote,
  schoolQuotes,
  schoolCreditNotes,
  schoolConfirmReceived,
  schoolInvoices,
  schoolLogin,
  schoolMe,
  schoolOrders,
  schoolPortalInfo,
  schoolPriceList,
  schoolReceipts,
  schoolStatement,
  schoolSubmitOrder,
  type PriceItem,
  type SchoolCreditNote,
  type SchoolInvoice,
  type SchoolQuote,
  type SchoolMe,
  type SchoolOrder,
  type SchoolReceipt,
} from "../lib/school-api";
import type { DocStatement } from "@zaroda/ui";

const tokenKey = (slug: string) => `zaroda_school_token_${slug}`;
const readToken = (slug: string) => {
  try {
    return window.localStorage.getItem(tokenKey(slug));
  } catch {
    return null;
  }
};
const writeToken = (slug: string, token: string | null) => {
  try {
    if (token) window.localStorage.setItem(tokenKey(slug), token);
    else window.localStorage.removeItem(tokenKey(slug));
  } catch {
    /* nothing to do */
  }
};

const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";
const primary = "rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const STATUS: Record<SchoolOrder["status"], [string, string]> = {
  SUBMITTED: ["Waiting for the supplier", "bg-warning-50 text-warning-900"],
  CONFIRMED: ["Confirmed - on its way", "bg-primary-50 text-primary-900"],
  PARTIALLY_DELIVERED: ["Part delivered - the rest is to come", "bg-warning-50 text-warning-900"],
  DELIVERED: ["Delivered", "bg-success-50 text-success-900"],
  CANCELLED: ["Cancelled", "bg-secondary-500/10 text-secondary-600"],
};
const INVOICE: Record<SchoolInvoice["status"], string> = { ISSUED: "Unpaid", PARTIALLY_PAID: "Part paid", PAID: "Paid", VOID: "Cancelled" };
const METHOD: Record<string, string> = { CHEQUE: "Cheque", BANK_TRANSFER: "Bank transfer", MPESA: "M-Pesa", CASH: "Cash", WITHHOLDING_TAX: "Tax you withheld" };

/** A school's page on its supplier's ordering link: sign in with phone and PIN, see the price list, order, and follow invoices. */
export default function SchoolPortal({ slug }: { slug: string }) {
  const [ready, setReady] = useState(false);
  const [supplierName, setSupplierName] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const info = await schoolPortalInfo(slug).catch(() => null);
      setSupplierName(info?.displayName ?? null);
      const saved = readToken(slug);
      if (saved) {
        try {
          await schoolMe(saved);
          setToken(saved);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) writeToken(slug, null);
        }
      }
      setReady(true);
    })();
  }, [slug]);

  if (!ready) return <p className="py-10 text-center text-secondary-500">Loading...</p>;
  if (!supplierName) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border bg-surface p-6 text-center">
        <h1 className="text-xl font-bold">This link is not active</h1>
        <p className="mt-2 text-secondary-500">Check the link your supplier gave you, or ask them to switch ordering on.</p>
      </div>
    );
  }
  if (!token) {
    return (
      <SignIn
        slug={slug}
        supplierName={supplierName}
        onSignedIn={(t) => {
          writeToken(slug, t);
          setToken(t);
        }}
      />
    );
  }
  return (
    <Portal
      slug={slug}
      token={token}
      onSignOut={() => {
        writeToken(slug, null);
        setToken(null);
      }}
    />
  );
}

function SignIn({ slug, supplierName, onSignedIn }: { slug: string; supplierName: string; onSignedIn: (token: string) => void }) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await schoolLogin(slug, phone.trim(), pin);
      onSignedIn(r.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{supplierName}</h1>
        <p className="mt-1 text-secondary-500">Order school supplies. Sign in with the phone number and PIN your supplier gave you.</p>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">School sign-in</h2>
        <div>
          <label htmlFor="sc-phone" className="block text-sm font-medium">Phone number</label>
          <input id="sc-phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" className={field} />
        </div>
        <div>
          <label htmlFor="sc-pin" className="block text-sm font-medium">PIN</label>
          <PasswordInput id="sc-pin" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4-digit PIN" className={field} />
        </div>
        {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}
        <button type="submit" disabled={busy || phone.trim().length < 9 || pin.length < 4} className={`${primary} w-full`}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-center text-xs text-secondary-500">Lost your PIN? Ask {supplierName} for a new one.</p>
      </form>
    </div>
  );
}

type Tab = "order" | "quotes" | "orders" | "invoices" | "account";

function Portal({ slug, token, onSignOut }: { slug: string; token: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("order");
  const [me, setMe] = useState<SchoolMe | null>(null);
  const [orders, setOrders] = useState<SchoolOrder[] | null>(null);
  const [quotes, setQuotes] = useState<SchoolQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 401) onSignOut();
      else setError(err instanceof ApiError ? err.message : fallback);
    },
    [onSignOut],
  );

  const refresh = useCallback(async () => {
    try {
      const [m, o, q] = await Promise.all([schoolMe(token), schoolOrders(token), schoolQuotes(token).catch(() => [] as SchoolQuote[])]);
      setMe(m);
      setOrders(o);
      setQuotes(q);
      setError(null);
    } catch (err) {
      guard(err, "Could not load your account.");
    }
  }, [token, guard]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const waiting = orders?.filter((o) => o.status === "SUBMITTED" || o.status === "CONFIRMED").length ?? 0;
  const openQuotes = quotes?.filter((q) => q.status === "ISSUED").length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{me?.school.name ?? "..."}</h1>
          <p className="text-sm text-secondary-500">Ordering from {me?.supplier.name}</p>
        </div>
        <button onClick={onSignOut} className="text-sm text-primary-600 hover:underline">Sign out</button>
      </div>

      {me && (me.school.owed > 0 || me.school.credit > 0) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
          {me.school.owed > 0 && <span>You owe: <strong>{kes(me.school.owed)}</strong></span>}
          {me.school.overdue > 0 && <span className="text-error-600">Late: <strong>{kes(me.school.overdue)}</strong></span>}
          {me.school.credit > 0 && <span className="text-success-700">Paid in advance: <strong>{kes(me.school.credit)}</strong></span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["order", "New order"],
            ["quotes", `Quotations${openQuotes ? ` (${openQuotes})` : ""}`],
            ["orders", `My orders${waiting ? ` (${waiting})` : ""}`],
            ["invoices", "Invoices"],
            ["account", "Statement & receipts"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`rounded-full border px-4 py-2 text-sm ${tab === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}

      {tab === "order" && (
        <NewOrder
          token={token}
          guard={guard}
          onPlaced={async () => {
            await refresh();
            setTab("orders");
          }}
        />
      )}
      {tab === "quotes" && (
        <Quotes
          token={token}
          slug={slug}
          quotes={quotes}
          guard={guard}
          onChanged={refresh}
          onOrdered={async () => {
            await refresh();
            setTab("orders");
          }}
        />
      )}
      {tab === "orders" && <Orders token={token} slug={slug} orders={orders} guard={guard} onChanged={refresh} />}
      {tab === "invoices" && <Invoices token={token} slug={slug} guard={guard} />}
      {tab === "account" && <Account token={token} slug={slug} guard={guard} />}
    </div>
  );
}

type Guard = (err: unknown, fallback: string) => void;

const QUOTE_STATUS: Record<SchoolQuote["status"], [string, string]> = {
  DRAFT: ["Draft", "bg-secondary-500/10 text-secondary-600"],
  ISSUED: ["Open - waiting for your answer", "bg-warning-50 text-warning-900"],
  ACCEPTED: ["Accepted - now an order", "bg-success-50 text-success-900"],
  DECLINED: ["Declined", "bg-secondary-500/10 text-secondary-600"],
  EXPIRED: ["Ran out", "bg-secondary-500/10 text-secondary-600"],
  SUPERSEDED: ["Replaced by a newer quotation", "bg-secondary-500/10 text-secondary-600"],
};

/** Quotations the supplier has sent: accept one and it becomes your order at the quoted prices. */
function Quotes({ token, slug, quotes, guard, onChanged, onOrdered }: { token: string; slug: string; quotes: SchoolQuote[] | null; guard: Guard; onChanged: () => Promise<void>; onOrdered: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [lpo, setLpo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(q: SchoolQuote) {
    setBusy(true);
    setError(null);
    try {
      await schoolAcceptQuote(token, q.id, { lpoNumber: lpo.trim() || undefined });
      setLpo("");
      await onOrdered();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) guard(err, "");
      else setError(err instanceof ApiError ? err.message : "Could not accept it.");
    } finally {
      setBusy(false);
    }
  }

  async function decline(q: SchoolQuote) {
    const reason = window.prompt("Why are you declining? (optional)") ?? undefined;
    if (reason === undefined) return;
    try {
      await schoolDeclineQuote(token, q.id, reason.trim() || undefined);
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) guard(err, "");
      else setError(err instanceof ApiError ? err.message : "Could not decline it.");
    }
  }

  if (!quotes) return <p className="py-6 text-center text-secondary-500">Loading...</p>;
  if (quotes.length === 0) return <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No quotations yet. When your supplier sends you a quotation it appears here, and you can accept it to place the order.</p>;
  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}
      <ul className="space-y-3">
        {quotes.map((q) => (
          <li key={q.id} className="rounded-lg border border-border bg-surface">
            <button onClick={() => setOpenId(openId === q.id ? null : q.id)} className="flex w-full flex-wrap items-start justify-between gap-2 p-3 text-left">
              <div>
                <p className="font-semibold">{q.quoteNumber}</p>
                <p className="text-xs text-secondary-500">
                  {q.issueDate}
                  {q.validUntil ? ` · open until ${q.validUntil}` : ""}
                </p>
              </div>
              <div className="text-right">
                <span className={`rounded px-2 py-0.5 text-xs ${QUOTE_STATUS[q.status][1]}`}>{QUOTE_STATUS[q.status][0]}</span>
                <p className="mt-1 font-semibold">{kes(q.total)}</p>
              </div>
            </button>
            {openId === q.id && (
              <div className="space-y-3 border-t border-border p-3 text-sm">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs uppercase text-secondary-500">
                      <th className="py-1">Item</th>
                      <th className="py-1 text-right">Qty</th>
                      <th className="py-1 text-right">Price</th>
                      <th className="py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.lines.map((l) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-1">{l.description}</td>
                        <td className="py-1 text-right">{l.quantity}</td>
                        <td className="py-1 text-right">{l.unitPrice.toFixed(2)}</td>
                        <td className="py-1 text-right">{(l.lineTotal + l.taxAmount).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-right text-xs text-secondary-500">Before VAT {kes(q.subtotal)} · VAT {kes(q.taxAmount)} · <span className="font-semibold text-foreground">Total {kes(q.total)}</span></p>
                {q.terms && <p className="whitespace-pre-line text-secondary-600">{q.terms}</p>}
                {q.decisionNote && <p className="text-secondary-600">Note: {q.decisionNote}</p>}
                {q.order && <p className="text-secondary-600">This became order {q.order.orderNumber}.</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/schools/${slug}/print/quote/${q.id}`} target="_blank" className="text-primary-600 hover:underline">Print</Link>
                  {q.status === "ISSUED" && (
                    <>
                      <input value={lpo} onChange={(e) => setLpo(e.target.value)} maxLength={60} placeholder="Your LPO number (if you have one)" className="rounded-md border border-border bg-surface p-1.5" />
                      <button disabled={busy} onClick={() => void accept(q)} className={`${primary}`}>
                        {busy ? "Placing..." : "Accept and place the order"}
                      </button>
                      <button onClick={() => void decline(q)} className="text-error-600 hover:underline">Decline</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewOrder({ token, guard, onPlaced }: { token: string; guard: Guard; onPlaced: () => Promise<void> }) {
  const [items, setItems] = useState<PriceItem[] | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [lpo, setLpo] = useState("");
  const [notes, setNotes] = useState("");
  const [wantedBy, setWantedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    schoolPriceList(token)
      .then(setItems)
      .catch((err) => guard(err, "Could not load the price list."));
  }, [token, guard]);

  const chosen = useMemo(() => (items ?? []).filter((i) => Number(qtys[i.variantId]) > 0), [items, qtys]);
  const totals = useMemo(() => {
    let net = 0;
    let tax = 0;
    for (const i of chosen) {
      const line = Math.round(Number(qtys[i.variantId]) * i.unitPrice * 100);
      net += line;
      tax += Math.round(line * i.taxRate);
    }
    return { net: net / 100, tax: tax / 100, total: (net + tax) / 100 };
  }, [chosen, qtys]);

  const shown = (items ?? []).filter((i) => {
    const q = search.trim().toLowerCase();
    return !q || i.title.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q);
  });

  async function place() {
    setBusy(true);
    setError(null);
    try {
      await schoolSubmitOrder(token, {
        lpoNumber: lpo.trim() || undefined,
        notes: notes.trim() || undefined,
        requestedDate: wantedBy || undefined,
        lines: chosen.map((i) => ({ variantId: i.variantId, quantity: Number(qtys[i.variantId]) })),
      });
      setQtys({});
      setLpo("");
      setNotes("");
      setWantedBy("");
      await onPlaced();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) guard(err, "");
      else setError(err instanceof ApiError ? err.message : "Could not send the order.");
    } finally {
      setBusy(false);
    }
  }

  if (!items) return <p className="py-6 text-center text-secondary-500">Loading the price list...</p>;
  if (items.length === 0) return <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">Your supplier has not put any items on the price list yet.</p>;

  return (
    <div className="space-y-4">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the price list" className={field} />
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {shown.map((i) => (
          <li key={i.variantId} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{i.title}</p>
              <p className="text-xs text-secondary-500">
                {kes(i.unitPrice)}{i.taxRate ? ` + ${Math.round(i.taxRate * 100)}% VAT` : ""}{i.category ? ` · ${i.category}` : ""}
              </p>
            </div>
            <input
              type="number"
              inputMode={i.allowsFractions ? "decimal" : "numeric"}
              min={0}
              step={i.allowsFractions ? "any" : 1}
              value={qtys[i.variantId] ?? ""}
              onChange={(e) => setQtys((q) => ({ ...q, [i.variantId]: e.target.value }))}
              placeholder="0"
              aria-label={`Quantity of ${i.title}`}
              className="w-24 rounded-md border border-border bg-surface p-2 text-right text-base"
            />
          </li>
        ))}
        {shown.length === 0 && <li className="p-3 text-sm text-secondary-500">Nothing matches that.</li>}
      </ul>

      <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Your order number (LPO) <span className="text-secondary-500">(optional)</span>
            <input maxLength={50} value={lpo} onChange={(e) => setLpo(e.target.value)} className={field} />
          </label>
          <label className="text-sm">
            Needed by <span className="text-secondary-500">(optional)</span>
            <input type="date" value={wantedBy} onChange={(e) => setWantedBy(e.target.value)} className={field} />
          </label>
          <label className="text-sm sm:col-span-2">
            Note to the supplier <span className="text-secondary-500">(optional)</span>
            <input maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
          </label>
        </div>
        <p className="text-sm text-secondary-500">
          {chosen.length} {chosen.length === 1 ? "item" : "items"} · before VAT {kes(totals.net)} · VAT {kes(totals.tax)} · <strong className="text-foreground">Total {kes(totals.total)}</strong>
        </p>
        <p className="text-xs text-secondary-500">The supplier will confirm your order, then deliver it with a delivery note and invoice. You pay later, as agreed.</p>
        {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}
        <button disabled={busy || chosen.length === 0} onClick={() => void place()} className={`${primary} w-full`}>
          {busy ? "Sending..." : "Send order"}
        </button>
      </div>
    </div>
  );
}

function Orders({ token, slug, orders, guard, onChanged }: { token: string; slug: string; orders: SchoolOrder[] | null; guard: Guard; onChanged: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receivedBy, setReceivedBy] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  async function confirmReceived(deliveryId: string) {
    if (receivedBy.trim().length < 2) {
      setError("Enter the name of the person who received the goods.");
      return;
    }
    try {
      await schoolConfirmReceived(token, deliveryId, { name: receivedBy.trim() });
      setConfirming(null);
      setReceivedBy("");
      setError(null);
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) guard(err, "");
      else setError(err instanceof ApiError ? err.message : "Could not confirm it.");
    }
  }

  async function cancel(o: SchoolOrder) {
    if (!window.confirm(`Withdraw order ${o.orderNumber}?`)) return;
    try {
      await schoolCancelOrder(token, o.id, "Cancelled by the school");
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) guard(err, "");
      else setError(err instanceof ApiError ? err.message : "Could not cancel it.");
    }
  }

  if (!orders) return <p className="py-6 text-center text-secondary-500">Loading...</p>;
  if (orders.length === 0) return <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">You have not sent any orders yet.</p>;

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id} className="rounded-lg border border-border bg-surface">
            <button onClick={() => setOpenId(openId === o.id ? null : o.id)} className="flex w-full flex-wrap items-start justify-between gap-2 p-3 text-left">
              <div>
                <p className="font-semibold">{o.orderNumber}</p>
                <p className="text-xs text-secondary-500">
                  {new Date(o.submittedAt).toLocaleDateString("en-KE")}
                  {o.lpoNumber ? ` · LPO ${o.lpoNumber}` : ""}
                </p>
              </div>
              <div className="text-right">
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS[o.status][1]}`}>{STATUS[o.status][0]}</span>
                <p className="mt-1 font-semibold">{kes(o.total)}</p>
              </div>
            </button>
            {openId === o.id && (
              <div className="space-y-3 border-t border-border p-3 text-sm">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs uppercase text-secondary-500">
                      <th className="py-1">Item</th>
                      <th className="py-1 text-right">Asked</th>
                      {o.status !== "SUBMITTED" && o.status !== "CANCELLED" && <th className="py-1 text-right">Confirmed</th>}
                      {o.deliveries.length > 0 && <th className="py-1 text-right">Delivered</th>}
                      {o.hasBalance && <th className="py-1 text-right">Still to come</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {o.lines.map((l) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-1">{l.title}</td>
                        <td className="py-1 text-right">{l.quantityOrdered}</td>
                        {o.status !== "SUBMITTED" && o.status !== "CANCELLED" && <td className="py-1 text-right">{l.quantityConfirmed ?? l.quantityOrdered}</td>}
                        {o.deliveries.length > 0 && <td className="py-1 text-right">{l.quantityDelivered}</td>}
                        {o.hasBalance && <td className="py-1 text-right font-semibold">{l.balance > 0 ? l.balance : "-"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {o.confirmationNote && <p className="text-secondary-600">Supplier&apos;s note: {o.confirmationNote}</p>}
                {o.status === "CANCELLED" && <p className="text-secondary-600">Cancelled by {o.cancelledBy === "SCHOOL" ? "you" : "the supplier"}: {o.cancelReason}</p>}
                <div className="flex flex-wrap gap-4">
                  {o.status === "SUBMITTED" && <button onClick={() => void cancel(o)} className="text-error-600 hover:underline">Withdraw this order</button>}
                </div>
                {o.balanceClosedNote && <p className="text-secondary-600">The supplier closed this order with what was delivered. Reason: {o.balanceClosedNote}</p>}
                {o.deliveries.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase text-secondary-500">Deliveries</p>
                    {o.deliveries.map((d) => (
                      <div key={d.id} className="rounded-md border border-border p-2">
                        <p className="text-secondary-600">
                          {new Date(d.deliveredAt).toLocaleDateString("en-KE")} · received by {d.receivedByName} · {d.lines.map((l) => `${l.quantity} ${l.title}`).join(", ")}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-4">
                          <Link href={`/schools/${slug}/print/delivery-note/${d.id}`} target="_blank" className="text-primary-600 hover:underline">Delivery note {d.deliveryNoteNumber}</Link>
                          {d.invoice && <Link href={`/schools/${slug}/print/invoice/${d.invoice.id}`} target="_blank" className="text-primary-600 hover:underline">Invoice {d.invoice.invoiceNumber} · {kes(d.invoice.total)}</Link>}
                          {d.schoolConfirmedAt ? (
                            <span className="text-success-700">Receipt confirmed by {d.schoolConfirmedBy}</span>
                          ) : confirming === d.id ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} maxLength={100} placeholder="Who received the goods?" className="rounded-md border border-border bg-surface p-1" />
                              <button onClick={() => void confirmReceived(d.id)} className="rounded-md bg-primary-600 px-3 py-1 font-semibold text-white">Confirm</button>
                              <button onClick={() => setConfirming(null)} className="text-secondary-500 hover:underline">Not now</button>
                            </span>
                          ) : (
                            <button onClick={() => { setConfirming(d.id); setReceivedBy(""); }} className="text-primary-600 hover:underline">We received these goods</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Invoices({ token, slug, guard }: { token: string; slug: string; guard: Guard }) {
  const [invoices, setInvoices] = useState<SchoolInvoice[] | null>(null);
  const [credits, setCredits] = useState<SchoolCreditNote[]>([]);
  useEffect(() => {
    schoolInvoices(token)
      .then(setInvoices)
      .catch((err) => guard(err, "Could not load your invoices."));
    schoolCreditNotes(token)
      .then(setCredits)
      .catch(() => setCredits([]));
  }, [token, guard]);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

  if (!invoices) return <p className="py-6 text-center text-secondary-500">Loading...</p>;
  if (invoices.length === 0) return <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No invoices yet. You get one when an order is delivered.</p>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {invoices.map((i) => (
        <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
          <div>
            <p className="font-semibold">{i.invoiceNumber}</p>
            <p className="text-xs text-secondary-500">
              Issued {i.issueDate} · due {i.dueDate}
              {i.status !== "PAID" && i.status !== "VOID" && i.dueDate < today ? <span className="ml-1 text-error-600">late</span> : null}
            </p>
            <Link href={`/schools/${slug}/print/invoice/${i.id}`} target="_blank" className="text-xs text-primary-600 hover:underline">Print</Link>
          </div>
          <div className="text-right">
            <p className="text-xs text-secondary-500">{INVOICE[i.status]}</p>
            <p className="font-semibold">{kes(i.total)}</p>
            {i.status !== "VOID" && i.creditAmount > 0 && <p className="text-xs text-secondary-500">credited {kes(i.creditAmount)}</p>}
            {i.status !== "VOID" && i.balance > 0 && (i.amountPaid > 0 || i.creditAmount > 0) && <p className="text-xs text-secondary-500">still owe {kes(i.balance)}</p>}
            {i.status !== "VOID" && (i.retentionHeld ?? 0) > 0 && <p className="text-xs text-secondary-500">retention held {kes(i.retentionHeld ?? 0)}{i.retentionReleaseDate ? `, due for release ${i.retentionReleaseDate}` : ""}</p>}
          </div>
        </li>
      ))}
      {credits.length > 0 && (
        <li className="p-3 text-sm">
          <p className="mb-2 text-xs uppercase text-secondary-500">Credit notes</p>
          {credits.map((c) => (
            <p key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-1">
              <span>
                {c.creditNumber} · {c.issueDate} · against {c.invoice.invoiceNumber} · {c.reasonText}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-semibold">- {kes(c.total)}</span>
                <Link href={`/schools/${slug}/print/credit-note/${c.id}`} target="_blank" className="text-xs text-primary-600 hover:underline">Print</Link>
              </span>
            </p>
          ))}
        </li>
      )}
    </ul>
  );
}

function Account({ token, slug, guard }: { token: string; slug: string; guard: Guard }) {
  const [statement, setStatement] = useState<DocStatement | null>(null);
  const [receipts, setReceipts] = useState<SchoolReceipt[] | null>(null);
  useEffect(() => {
    Promise.all([schoolStatement(token), schoolReceipts(token)])
      .then(([s, r]) => {
        setStatement(s);
        setReceipts(r);
      })
      .catch((err) => guard(err, "Could not load your statement."));
  }, [token, guard]);

  if (!statement || !receipts) return <p className="py-6 text-center text-secondary-500">Loading...</p>;
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Statement</h2>
          <Link href={`/schools/${slug}/print/statement/me`} target="_blank" className="text-sm text-primary-600 hover:underline">Print statement</Link>
        </div>
        {statement.entries.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">Nothing on your account yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-secondary-500">
                  <th className="p-2">Date</th>
                  <th className="p-2">Details</th>
                  <th className="p-2 text-right">Invoiced</th>
                  <th className="p-2 text-right">Paid</th>
                  <th className="p-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">{e.date}</td>
                    <td className="p-2">{e.reference}</td>
                    <td className="p-2 text-right">{e.debit ? kes(e.debit) : ""}</td>
                    <td className="p-2 text-right">{e.credit ? kes(e.credit) : ""}</td>
                    <td className="p-2 text-right font-medium">{kes(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-right font-semibold">
          {statement.closingBalance > 0 ? `You owe ${kes(statement.closingBalance)}` : statement.closingBalance < 0 ? `You are ${kes(-statement.closingBalance)} in credit` : "Fully paid up"}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Receipts for your payments</h2>
        {receipts.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No payments received yet.</p>}
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {receipts.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <p className="font-semibold">{r.receiptNumber}</p>
                <p className="text-xs text-secondary-500">
                  {r.receivedOn} · {METHOD[r.method] ?? r.method}
                  {r.reference ? ` ${r.reference}` : ""}
                  {r.status === "BOUNCED" ? " · did not clear" : ""}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-semibold ${r.status === "BOUNCED" ? "text-secondary-500 line-through" : ""}`}>{kes(r.amount)}</p>
                <Link href={`/schools/${slug}/print/receipt/${r.id}`} target="_blank" className="text-xs text-primary-600 hover:underline">Print</Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
