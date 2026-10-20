"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KENYA_COUNTIES } from "@zaroda/ui";
import { ApiError, createOrder } from "../lib/api";
import { useMyCounty } from "../lib/my-county";
import { displayPhone, formatQty, kes } from "../lib/format";
import type { Shop } from "../lib/types";
import AuthForm from "./auth-form";
import { cartTotals, percentLabel } from "./cart-summary";
import { useStore } from "./store-provider";

type Fulfilment = "PICKUP" | "DELIVERY";

export default function CheckoutView({ shop }: { shop: Shop }) {
  const router = useRouter();
  const { ready, buyer, token, cartFor, clearCart } = useStore();

  const defaultFulfilment: Fulfilment = shop.pickupEnabled ? "PICKUP" : "DELIVERY";
  const [fulfilment, setFulfilment] = useState<Fulfilment>(defaultFulfilment);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [myCounty, setMyCounty] = useMyCounty();
  const [county, setCounty] = useState("");
  const [pickupOk, setPickupOk] = useState(false);
  const [note, setNote] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (buyer) {
      setName((current) => current || buyer.name || "");
      // A shopper who signed in by email has no number yet - they type it once, and it is
      // remembered for next time.
      setPaymentPhone((current) => current || (buyer.phone ? displayPhone(buyer.phone) : ""));
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

  const { amountDue, items: itemsTotal, fee } = cartTotals(lines, shop.convenienceFeeRate);
  // Food and goods cannot travel across the country: a shop that has said where it delivers only offers those counties.
  const served = shop.deliveryCounties;
  const deliveryCounties: readonly string[] = served ?? KENYA_COUNTIES;
  const myCountyServed = !myCounty || served === null || served.includes(myCounty);
  useEffect(() => {
    setCounty((current) => (current && deliveryCounties.includes(current) ? current : myCounty && deliveryCounties.includes(myCounty) ? myCounty : deliveryCounties.length === 1 ? deliveryCounties[0] : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCounty, served]);
  // Collecting from a shop in another county than the one they are in: make sure it is on purpose.
  const shopCounty = shop.location?.county ?? null;
  const farPickup = fulfilment === "PICKUP" && Boolean(myCounty) && Boolean(shopCounty) && myCounty !== shopCounty;
  const canDeliver = shop.deliveryEnabled;
  const canPickup = shop.pickupEnabled;

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!token || lines.length === 0) return;
    if (fulfilment === "DELIVERY" && !county) {
      setError("Choose the county we are delivering to.");
      return;
    }
    if (farPickup && !pickupOk) {
      setError(`Please confirm you will collect your order from ${shopCounty}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder(token, {
        shopSlug: shop.slug,
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        fulfilmentType: fulfilment,
        deliveryAddress: fulfilment === "DELIVERY" ? address.trim() : undefined,
        deliveryCounty: fulfilment === "DELIVERY" ? county : undefined,
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
                  {served && <span className="mt-0.5 block text-xs font-medium text-secondary-600">Delivers in {served.join(", ")} only.</span>}
                  {!myCountyServed && <span className="mt-0.5 block text-xs font-medium text-warning-700">This shop cannot deliver to {myCounty}. Choose pickup, or order from a shop in {myCounty}.</span>}
                </span>
              </label>
            )}
          </fieldset>

          {fulfilment === "PICKUP" && farPickup && (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-warning-600/40 bg-warning-50 p-3 text-sm text-warning-900">
              <input type="checkbox" checked={pickupOk} onChange={(e) => setPickupOk(e.target.checked)} className="mt-1" />
              <span>
                This shop is in <strong>{shopCounty}</strong> but you said you are in {myCounty}. I will collect my order from the shop myself.
              </span>
            </label>
          )}

          {fulfilment === "DELIVERY" && (
            <div>
              <label htmlFor="delivery-county" className="block text-sm font-medium">
                Which county are we delivering to?
              </label>
              <select
                id="delivery-county"
                required
                value={county}
                onChange={(e) => {
                  setCounty(e.target.value);
                  setMyCounty(e.target.value);
                }}
                className="mt-1 mb-4 w-full rounded-md border border-border bg-surface p-3 text-base"
              >
                <option value="">Choose a county</option>
                {deliveryCounties.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
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
                placeholder="Area first, e.g. Milimani, Kisumu - then street, house number, landmark"
                className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base"
              />
              <p className="mt-1 text-xs text-secondary-500">
                Start with your area. Riders see only the area when they decide whether to deliver; the full address goes to the rider you choose.
              </p>
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
            <p className="mt-1 text-xs text-secondary-500">
              You&apos;ll get an M-Pesa prompt on this phone. Enter your PIN to pay the shop directly. The shop may also use this number to reach you about your order.
            </p>
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
          {fee > 0 && (
            <div className="space-y-1 border-t border-border pt-3 text-sm text-secondary-600">
              <div className="flex justify-between">
                <span>Items</span>
                <span className="font-mono">{kes(itemsTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Convenience fee ({percentLabel(shop.convenienceFeeRate)})</span>
                <span className="font-mono">{kes(fee)}</span>
              </div>
            </div>
          )}
          <div className={`flex justify-between pt-3 text-lg font-bold ${fee > 0 ? "" : "border-t border-border"}`}>
            <span>To pay</span>
            <span>{kes(amountDue)}</span>
          </div>
          <p className="text-xs text-secondary-500">
            Totals are in whole shillings, as M-Pesa only takes whole amounts.{fee > 0 ? " The convenience fee helps keep Zaroda running; the shop passes it on to us." : ""}
          </p>
          {error && <p className="text-sm text-error-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || lines.length === 0 || (fulfilment === "DELIVERY" && (address.trim().length < 5 || !county)) || (farPickup && !pickupOk)}
            className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? "Placing order..." : `Place order and pay ${kes(amountDue)}`}
          </button>
        </aside>
      </form>
    </div>
  );
}
