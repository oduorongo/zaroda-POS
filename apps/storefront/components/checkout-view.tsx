"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, createOrder } from "../lib/api";
import { displayPhone, formatQty, kes } from "../lib/format";
import type { Shop } from "../lib/types";
import AuthForm from "./auth-form";
import { cartTotals } from "./cart-summary";
import { useStore } from "./store-provider";

type Fulfilment = "PICKUP" | "DELIVERY";

export default function CheckoutView({ shop }: { shop: Shop }) {
  const router = useRouter();
  const { ready, buyer, token, cartFor, clearCart } = useStore();

  const defaultFulfilment: Fulfilment = shop.pickupEnabled ? "PICKUP" : "DELIVERY";
  const [fulfilment, setFulfilment] = useState<Fulfilment>(defaultFulfilment);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (buyer) {
      setName((current) => current || buyer.name || "");
      setPaymentPhone((current) => current || displayPhone(buyer.phone));
    }
  }, [buyer]);

  // Price and availability always come from what the shop shows right now,
  // not whatever was in the cart when the item was added - the server
  // re-prices the order anyway, this just makes the total honest up front.
  const { lines, unavailable } = useMemo(() => {
    const variants = new Map(shop.products.flatMap((p) => p.variants.map((v) => [v.id, { v, product: p }] as const)));
    const ok: { variantId: string; productName: string; sku: string; price: number; quantity: number; available: number }[] = [];
    const missing: string[] = [];
    for (const line of cartFor(shop.slug)) {
      const found = variants.get(line.variantId);
      if (!found || found.v.available <= 0) {
        missing.push(line.productName);
        continue;
      }
      ok.push({
        variantId: line.variantId,
        productName: found.product.name,
        sku: found.v.sku,
        price: found.v.price,
        quantity: Math.min(line.quantity, found.v.available),
        available: found.v.available,
      });
    }
    return { lines: ok, unavailable: missing };
    // cartFor changes identity whenever the cart does, which is what we want.
  }, [shop, cartFor]);

  const { amountDue } = cartTotals(lines);
  const canDeliver = shop.deliveryEnabled;
  const canPickup = shop.pickupEnabled;

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!token || lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder(token, {
        shopSlug: shop.slug,
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        fulfilmentType: fulfilment,
        deliveryAddress: fulfilment === "DELIVERY" ? address.trim() : undefined,
        note: note.trim() || undefined,
        buyerName: name.trim() || undefined,
        paymentPhone: paymentPhone.trim() || undefined,
      });
      clearCart(shop.slug);
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place your order. Please try again.");
      setBusy(false);
    }
  }

  if (!ready) return <p className="py-10 text-center text-secondary-500">Loading...</p>;

  if (cartFor(shop.slug).length === 0) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-10 text-center">
        <h1 className="text-xl font-semibold">Your cart is empty</h1>
        <Link href={`/s/${shop.slug}`} className="inline-block rounded-md bg-primary-600 px-5 py-3 font-semibold text-white">
          Back to {shop.name}
        </Link>
      </div>
    );
  }

  if (!buyer) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-lg border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold">Sign in to place your order</h1>
        <p className="text-sm text-secondary-600">We use your phone number so the shop can reach you and you can follow your order.</p>
        <AuthForm />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={`/s/${shop.slug}`} className="text-sm text-primary-600 hover:underline">
          Back to {shop.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Checkout</h1>
      </div>

      <form onSubmit={placeOrder} className="grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">How would you like to get it?</legend>
            {canPickup && (
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface p-3">
                <input type="radio" name="fulfilment" checked={fulfilment === "PICKUP"} onChange={() => setFulfilment("PICKUP")} className="mt-1" />
                <span>
                  <span className="block font-medium">Pick up in store</span>
                  <span className="block text-xs text-secondary-500">
                    {shop.location ? `${shop.location.branchName}${shop.location.county ? `, ${shop.location.county}` : ""}` : shop.name}. We&apos;ll text you when it&apos;s ready.
                  </span>
                </span>
              </label>
            )}
            {canDeliver && (
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface p-3">
                <input type="radio" name="fulfilment" checked={fulfilment === "DELIVERY"} onChange={() => setFulfilment("DELIVERY")} className="mt-1" />
                <span>
                  <span className="block font-medium">Delivery</span>
                  <span className="block text-xs text-secondary-500">The shop delivers to you. Agree any delivery fee with the shop directly; it isn&apos;t part of this payment.</span>
                </span>
              </label>
            )}
          </fieldset>

          {fulfilment === "DELIVERY" && (
            <div>
              <label htmlFor="address" className="block text-sm font-medium">
                Delivery address
              </label>
              <textarea
                id="address"
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Estate, street, house number, any landmark"
                className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base"
              />
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium">
              Your name
            </label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base" />
          </div>

          <div>
            <label htmlFor="note" className="block text-sm font-medium">
              Note for the shop <span className="font-normal text-secondary-500">(optional)</span>
            </label>
            <textarea id="note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base" />
          </div>

          <div>
            <label htmlFor="pay-phone" className="block text-sm font-medium">
              M-Pesa number to pay with
            </label>
            <input
              id="pay-phone"
              type="tel"
              inputMode="tel"
              required
              value={paymentPhone}
              onChange={(e) => setPaymentPhone(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base"
            />
            <p className="mt-1 text-xs text-secondary-500">You&apos;ll get an M-Pesa prompt on this phone. Enter your PIN to pay the shop directly.</p>
          </div>
        </div>

        <aside className="h-fit space-y-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Order summary</h2>
          <ul className="space-y-2 text-sm">
            {lines.map((l) => (
              <li key={l.variantId} className="flex justify-between gap-2">
                <span>
                  {formatQty(l.quantity)} x {l.productName}
                </span>
                <span className="font-mono">{kes(Math.round(l.price * l.quantity * 100) / 100)}</span>
              </li>
            ))}
          </ul>
          {unavailable.length > 0 && (
            <p className="rounded-md bg-warning-50 p-2 text-xs text-warning-700">No longer available and left out: {unavailable.join(", ")}.</p>
          )}
          <div className="flex justify-between border-t border-border pt-3 text-lg font-bold">
            <span>To pay</span>
            <span>{kes(amountDue)}</span>
          </div>
          <p className="text-xs text-secondary-500">Totals are rounded up to the next whole shilling, as M-Pesa only takes whole amounts.</p>
          {error && <p className="text-sm text-error-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || lines.length === 0 || (fulfilment === "DELIVERY" && address.trim().length < 5)}
            className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? "Placing order..." : `Place order and pay ${kes(amountDue)}`}
          </button>
        </aside>
      </form>
    </div>
  );
}
