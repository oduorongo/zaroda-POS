"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";
import { ApiError, createTableOrder } from "../lib/api";
import { formatQty, kes } from "../lib/format";
import type { Shop, TableInfo } from "../lib/types";
import { cartTotals } from "./cart-summary";
import ProductCard from "./product-card";
import { useStore } from "./store-provider";

const ORDERS_KEY = "zaroda_table_orders";
const PHONE_KEY = "zaroda_table_phone";

/** The diner's own orders, so a refresh or a return visit finds the order page again. Browser storage may be blocked; the page still works. */
function rememberOrder(id: string, token: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDERS_KEY) ?? "{}") as Record<string, string>;
    localStorage.setItem(ORDERS_KEY, JSON.stringify({ ...saved, [id]: token }));
  } catch {
    /* the link the diner is sent to carries the secret anyway */
  }
}

/** Where the bottom ribbon ends: a fixed bar must sit above it or the ribbon hides it (see CartSummary). */
function useRibbonHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;
    const update = () => setHeight(footer.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);
  return height;
}

/**
 * A diner scanned the QR code on their table: the restaurant's menu, with what the kitchen can no longer make already
 * greyed out as sold out, and a one-screen order-and-pay (no account, just an M-Pesa number).
 */
export default function TableMenu({ shop, table }: { shop: Shop; table: TableInfo }) {
  const router = useRouter();
  const { ready, cartFor, clearCart } = useStore();
  // The cart is kept per table, so a diner at table 5 never sees what someone had in a normal shop visit.
  const cartKey = `${shop.slug}:table:${table.id}`;
  const ribbonHeight = useRibbonHeight();

  const [category, setCategory] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  // A request for each dish ("no onions"), by dish.
  const [dishNotes, setDishNotes] = useState<Record<string, string>>({});
  const [tipChoice, setTipChoice] = useState<"none" | "5" | "10" | "custom">("none");
  const [customTip, setCustomTip] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setPhone(localStorage.getItem(PHONE_KEY) ?? "");
    } catch {
      /* only a convenience */
    }
  }, []);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of shop.products) if (p.category) seen.set(p.category.id, p.category.name);
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
  }, [shop.products]);
  const products = shop.products.filter((p) => !category || p.category?.id === category);

  // What is in the cart, priced and checked against what the kitchen can make right now.
  const { lines, dropped } = useMemo(() => {
    const variants = new Map(shop.products.flatMap((p) => p.variants.map((v) => [v.id, { v, product: p }] as const)));
    const ok: { variantId: string; productName: string; price: number; quantity: number }[] = [];
    const gone: string[] = [];
    for (const line of cartFor(cartKey)) {
      const found = variants.get(line.variantId);
      if (!found || found.v.available <= 0) {
        gone.push(line.productName);
        continue;
      }
      ok.push({ variantId: line.variantId, productName: found.product.name, price: found.v.price, quantity: Math.min(line.quantity, found.v.available) });
    }
    return { lines: ok, dropped: gone };
  }, [shop, cartFor, cartKey]);
  const { amountDue: foodDue } = cartTotals(lines);
  // Tips are whole shillings, like everything M-Pesa moves.
  const tip = tipChoice === "none" ? 0 : tipChoice === "custom" ? Math.min(10_000, Math.max(0, Math.floor(Number(customTip) || 0))) : Math.round((foodDue * Number(tipChoice)) / 100);
  const amountDue = foodDue + tip;
  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const order = await createTableOrder({
        shopSlug: shop.slug,
        tableId: table.id,
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, note: dishNotes[l.variantId]?.trim() || undefined })),
        phone: phone.trim(),
        tipAmount: tip > 0 ? tip : undefined,
        name: name.trim() || undefined,
        note: note.trim() || undefined,
      });
      try {
        localStorage.setItem(PHONE_KEY, phone.trim());
      } catch {
        /* only a convenience */
      }
      rememberOrder(order.id, order.guestToken);
      clearCart(cartKey);
      router.push(`/t/${order.id}?k=${encodeURIComponent(order.guestToken)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place your order. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 pb-28">
      <div className="rounded-xl bg-primary-600 px-5 py-5 text-white">
        <p className="flex items-center gap-2 text-sm text-primary-50">
          <UtensilsCrossed size={16} aria-hidden /> You&apos;re at
        </p>
        <h1 className="text-2xl font-bold">{table.label}</h1>
        <p className="mt-1 text-sm text-primary-50">{shop.name} - order here, pay with M-Pesa, and your food comes to the table.</p>
      </div>

      {!table.acceptsOrders ? (
        <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-600">
          Ordering from the table isn&apos;t switched on yet. Please call a waiter - they&apos;ll be happy to take your order.
        </p>
      ) : (
        <>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setCategory(null)} className={`rounded-full border px-3 py-1 text-sm ${!category ? "border-primary-600 bg-primary-600 text-white" : "border-border bg-surface"}`}>
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(category === c.id ? null : c.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${category === c.id ? "border-primary-600 bg-primary-600 text-white" : "border-border bg-surface"}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {products.length === 0 ? (
            <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-500">Nothing on the menu right now.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <ProductCard key={product.id} shopSlug={cartKey} product={product} />
              ))}
            </div>
          )}

          {ready && count > 0 && !checkingOut && (
            <div style={{ bottom: ribbonHeight }} className="fixed inset-x-0 z-30 border-t border-border bg-surface p-3 shadow-[0_-4px_12px_rgba(15,23,42,0.12)]">
              <div className="mx-auto max-w-3xl">
                <button onClick={() => setCheckingOut(true)} className="flex w-full items-center justify-between rounded-md bg-primary-600 px-4 py-3 font-semibold text-white">
                  <span>
                    {formatQty(count)} {count === 1 ? "item" : "items"}
                  </span>
                  <span>Order &amp; pay - {kes(amountDue)}</span>
                </button>
              </div>
            </div>
          )}

          {checkingOut && (
            <form onSubmit={placeOrder} className="space-y-4 rounded-lg border border-border bg-surface p-4">
              <h2 className="text-lg font-semibold">Your order</h2>
              <ul className="space-y-2 text-sm">
                {lines.map((l) => (
                  <li key={l.variantId} className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <span>
                        {formatQty(l.quantity)} x {l.productName}
                      </span>
                      <span className="font-mono">{kes(Math.round(l.price * l.quantity * 100) / 100)}</span>
                    </div>
                    <input
                      value={dishNotes[l.variantId] ?? ""}
                      onChange={(e) => setDishNotes({ ...dishNotes, [l.variantId]: e.target.value })}
                      maxLength={120}
                      placeholder="Anything for this dish? e.g. no onions, extra spicy"
                      aria-label={`Note for ${l.productName}`}
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
                    />
                  </li>
                ))}
              </ul>
              {dropped.length > 0 && <p className="rounded-md bg-warning-50 p-2 text-xs text-warning-700">Just finished and left out: {dropped.join(", ")}.</p>}
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-sm font-medium">
                  Add a tip for the staff? <span className="font-normal text-secondary-500">(optional)</span>
                </p>
                <div className="flex flex-wrap gap-2 text-sm">
                  {(
                    [
                      ["none", "No tip"],
                      ["5", "5%"],
                      ["10", "10%"],
                      ["custom", "Other"],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setTipChoice(value)} className={`rounded-full border px-3 py-1 ${tipChoice === value ? "border-primary-600 bg-primary-600 text-white" : "border-border"}`}>
                      {label}
                    </button>
                  ))}
                  {tipChoice === "custom" && (
                    <input type="number" inputMode="numeric" min={0} max={10000} value={customTip} onChange={(e) => setCustomTip(e.target.value)} placeholder="KES" aria-label="Tip amount in shillings" className="w-24 rounded-md border border-border bg-surface px-2 py-1" />
                  )}
                </div>
                {tip > 0 && (
                  <p className="flex justify-between text-sm text-secondary-600">
                    <span>Food and drink {kes(foodDue)}</span>
                    <span>Tip {kes(tip)}</span>
                  </p>
                )}
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>To pay</span>
                <span>{kes(amountDue)}</span>
              </div>

              <div>
                <label htmlFor="pay-phone" className="block text-sm font-medium">
                  M-Pesa number to pay with
                </label>
                <input id="pay-phone" type="tel" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base" />
                <p className="mt-1 text-xs text-secondary-500">You&apos;ll get a prompt on this phone. Enter your PIN and your order goes straight to the kitchen.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium">
                    Your name <span className="font-normal text-secondary-500">(optional)</span>
                  </label>
                  <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base" />
                </div>
                <div>
                  <label htmlFor="note" className="block text-sm font-medium">
                    Note for the kitchen <span className="font-normal text-secondary-500">(optional)</span>
                  </label>
                  <input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. no chilli" className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base" />
                </div>
              </div>
              {error && <p className="text-sm text-error-600">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || lines.length === 0 || phone.trim().length < 9} className="flex-1 rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  {busy ? "Sending..." : `Pay ${kes(amountDue)} with M-Pesa`}
                </button>
                <button type="button" onClick={() => setCheckingOut(false)} className="rounded-md border border-border px-4 py-3">
                  Back to menu
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
