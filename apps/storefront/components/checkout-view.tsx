"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KENYA_COUNTIES } from "@zaroda/ui";
import { ApiError, createGuestOrder, createOrder } from "../lib/api";
import { useMyCounty } from "../lib/my-county";
import { distanceKm, kmLabel, useMyLocation } from "../lib/my-location";
import { displayPhone, formatQty, kes, variantTitle } from "../lib/format";
import { checkoutDetails, guestOrderPath, rememberCheckoutDetails, rememberGuestOrder } from "../lib/remember";
import type { Shop } from "../lib/types";
import AuthForm from "./auth-form";
import { cartTotals, percentLabel } from "./cart-summary";
import PracticeBanner from "./practice-banner";
import { useStore } from "./store-provider";

type Fulfilment = "PICKUP" | "DELIVERY";

const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";

/**
 * One short screen. No account is needed: a guest gives only their M-Pesa number (the prompt proves the phone is
 * theirs) and follows the order through a private link. What a shopper typed last time is remembered on this device,
 * so a returning shopper just checks the total and taps Pay.
 */
export default function CheckoutView({ shop }: { shop: Shop }) {
  const router = useRouter();
  const { ready, buyer, token, cartFor, clearCart } = useStore();

  const [fulfilment, setFulfilment] = useState<Fulfilment>(shop.pickupEnabled ? "PICKUP" : "DELIVERY");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [myCounty, setMyCounty] = useMyCounty();
  const [county, setCounty] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [paymentPhone, setPaymentPhone] = useState("");
  const [editPhone, setEditPhone] = useState(false);
  const [editName, setEditName] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fill in what this device remembers, then what the account knows.
  useEffect(() => {
    const saved = checkoutDetails();
    if (saved.fulfilment === "DELIVERY" && shop.deliveryEnabled) setFulfilment("DELIVERY");
    if (saved.fulfilment === "PICKUP" && shop.pickupEnabled) setFulfilment("PICKUP");
    if (saved.address) setAddress(saved.address);
    if (saved.county) setCounty(saved.county);
    setName((current) => current || saved.name || "");
    setPaymentPhone((current) => current || saved.phone || "");
  }, [shop.deliveryEnabled, shop.pickupEnabled]);

  useEffect(() => {
    if (!buyer) return;
    setName((current) => buyer.name || current);
    setPaymentPhone((current) => (buyer.phone ? displayPhone(buyer.phone) : current));
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
        productName: variantTitle(found.product.name, found.v.name),
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
  // Where the shop delivers: within a distance of its pin (needs the shopper's location), its counties, or anywhere in Kenya.
  const byDistance = shop.deliveryReach === "RADIUS" && Boolean(shop.deliveryRadiusKm) && shop.lat != null && shop.lng != null;
  const anywhere = shop.deliveryReach === "KENYA";
  const served = anywhere || byDistance ? null : shop.deliveryCounties;
  const deliveryCounties: readonly string[] = served ?? KENYA_COUNTIES;
  const myCountyServed = !myCounty || served === null || served.includes(myCounty);
  const { spot, locating, error: locateError, locate } = useMyLocation();
  const awayKm = byDistance && spot ? distanceKm(spot, { lat: shop.lat!, lng: shop.lng! }) : null;
  const tooFar = awayKm !== null && awayKm > (shop.deliveryRadiusKm ?? 0);
  useEffect(() => {
    setCounty((current) => (current && deliveryCounties.includes(current) ? current : myCounty && deliveryCounties.includes(myCounty) ? myCounty : deliveryCounties.length === 1 ? deliveryCounties[0] : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCounty, served]);
  const shopCounty = shop.location?.county ?? null;
  const farPickup = fulfilment === "PICKUP" && Boolean(myCounty) && Boolean(shopCounty) && myCounty !== shopCounty;
  const phoneKnown = paymentPhone.trim().length >= 9 && !editPhone;
  const nameKnown = name.trim().length > 0 && !editName;
  const deliveryReady = fulfilment !== "DELIVERY" || (address.trim().length >= 5 && (byDistance ? Boolean(spot) && !tooFar : Boolean(county)));

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return;
    if (!paymentPhone.trim()) {
      setError("Enter the M-Pesa number you will pay with.");
      return;
    }
    if (fulfilment === "DELIVERY" && !byDistance && !county) {
      setError("Choose the county we are delivering to.");
      return;
    }
    if (fulfilment === "DELIVERY" && byDistance && !spot) {
      setError(`Share your location so we can check you are within ${shop.deliveryRadiusKm} km, or choose pickup.`);
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      shopSlug: shop.slug,
      lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      fulfilmentType: fulfilment,
      deliveryAddress: fulfilment === "DELIVERY" ? address.trim() : undefined,
      deliveryCounty: fulfilment === "DELIVERY" ? county || undefined : undefined,
      ...(fulfilment === "DELIVERY" && spot ? { deliveryLat: spot.lat, deliveryLng: spot.lng } : {}),
      note: note.trim() || undefined,
      buyerName: name.trim() || undefined,
      paymentPhone: paymentPhone.trim(),
    };
    try {
      rememberCheckoutDetails({ name: name.trim() || undefined, phone: paymentPhone.trim(), fulfilment, ...(fulfilment === "DELIVERY" ? { county, address: address.trim() } : {}) });
      if (token) {
        const order = await createOrder(token, input);
        clearCart(shop.slug);
        router.push(`/orders/${order.id}`);
      } else {
        const order = await createGuestOrder(input);
        rememberGuestOrder({ id: order.id, key: order.guestToken, orderNumber: order.orderNumber, shopName: shop.name, createdAt: order.createdAt });
        clearCart(shop.slug);
        router.push(guestOrderPath(order.id, order.guestToken));
      }
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={`/s/${shop.slug}`} className="text-sm text-primary-600 hover:underline">
          Back to {shop.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Review and pay</h1>
        {shop.practice && (
          <div className="mt-2">
            <PracticeBanner>Your order is marked paid straight away. No M-Pesa prompt is sent and no money is taken.</PracticeBanner>
          </div>
        )}
        {!buyer && (
          <p className="mt-1 text-sm text-secondary-600">
            No account needed.{" "}
            <button type="button" onClick={() => setShowSignIn((v) => !v)} className="text-primary-600 hover:underline">
              {showSignIn ? "Order without signing in" : "Have an account? Sign in"}
            </button>
          </p>
        )}
      </div>

      {!buyer && showSignIn && (
        <div className="max-w-md rounded-lg border border-border bg-surface p-4">
          <AuthForm onDone={() => setShowSignIn(false)} />
        </div>
      )}

      <form onSubmit={placeOrder} className="grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {shop.pickupEnabled && shop.deliveryEnabled && (
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How would you like to get it?">
              {(["PICKUP", "DELIVERY"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={fulfilment === f}
                  onClick={() => setFulfilment(f)}
                  className={`rounded-md border p-3 text-left ${fulfilment === f ? "border-primary-600 bg-primary-600/10 font-semibold" : "border-border bg-surface"}`}
                >
                  {f === "PICKUP" ? "Pick up" : "Delivery"}
                </button>
              ))}
            </div>
          )}

          {fulfilment === "PICKUP" && (
            <p className="text-sm text-secondary-600">
              Collect from {shop.location ? `${shop.location.branchName}${shopCounty ? `, ${shopCounty}` : ""}` : shop.name}. We&apos;ll let you know when it&apos;s ready.
              {farPickup && (
                <span className="mt-1 block font-medium text-warning-700">
                  Note: this shop is in {shopCounty}, and you said you are in {myCounty}.
                </span>
              )}
            </p>
          )}

          {fulfilment === "DELIVERY" && (
            <div className="space-y-3">
              <p className="text-xs text-secondary-500">
                Agree any delivery fee with the shop or rider; it isn&apos;t part of this payment.
                {served ? ` Delivers in ${served.join(", ")} only.` : ""}
              </p>
              {!myCountyServed && <p className="text-xs font-medium text-warning-700">This shop cannot deliver to {myCounty}. Choose pickup, or order from a shop in {myCounty}.</p>}
              {byDistance && (
                <div className="rounded-md border border-border bg-surface p-3 text-sm">
                  {!spot ? (
                    <>
                      <p>
                        {shop.name} delivers within <strong>{shop.deliveryRadiusKm} km</strong>. Share your location so we can check it reaches you.
                      </p>
                      <button
                        type="button"
                        onClick={() => void locate()}
                        disabled={locating}
                        className="mt-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                      >
                        {locating ? "Finding you..." : "Share my location"}
                      </button>
                      {locateError && <p className="mt-1 text-xs text-warning-700">{locateError}</p>}
                    </>
                  ) : tooFar ? (
                    <p className="text-warning-700">
                      You are about {kmLabel(awayKm!)} away, and {shop.name} delivers within {shop.deliveryRadiusKm} km. Choose pickup, or order from a shop nearer you.{" "}
                      <button type="button" onClick={() => void locate()} className="underline">
                        Check again
                      </button>
                    </p>
                  ) : (
                    <p className="text-success-600">
                      You are about {kmLabel(awayKm!)} from the shop: it delivers to you.{" "}
                      <button type="button" onClick={() => void locate()} className="text-secondary-500 underline">
                        Update
                      </button>
                    </p>
                  )}
                </div>
              )}
              {!byDistance && deliveryCounties.length > 1 && (
                <div>
                  <label htmlFor="delivery-county" className="block text-sm font-medium">
                    County
                  </label>
                  <select
                    id="delivery-county"
                    required
                    value={county}
                    onChange={(e) => {
                      setCounty(e.target.value);
                      setMyCounty(e.target.value);
                    }}
                    className={field}
                  >
                    <option value="">Choose a county</option>
                    {deliveryCounties.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="address" className="block text-sm font-medium">
                  Delivery address
                </label>
                <textarea
                  id="address"
                  required
                  minLength={5}
                  maxLength={500}
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Area first, e.g. Milimani, Kisumu - then street, house, landmark"
                  className={field}
                />
                <p className="mt-1 text-xs text-secondary-500">Riders see only the area until you choose one.</p>
              </div>
            </div>
          )}

          {phoneKnown ? (
            <p className="text-sm">
              Pay with M-Pesa <strong>{paymentPhone}</strong>{" "}
              <button type="button" onClick={() => setEditPhone(true)} className="text-primary-600 hover:underline">
                Change
              </button>
            </p>
          ) : (
            <div>
              <label htmlFor="pay-phone" className="block text-sm font-medium">
                M-Pesa number
              </label>
              <input
                id="pay-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                placeholder="0712 345 678"
                value={paymentPhone}
                onChange={(e) => setPaymentPhone(e.target.value)}
                className={field}
              />
              <p className="mt-1 text-xs text-secondary-500">You&apos;ll get an M-Pesa prompt on this phone. The shop may use it to reach you about the order.</p>
            </div>
          )}

          {nameKnown ? (
            <p className="text-sm">
              Name <strong>{name}</strong>{" "}
              <button type="button" onClick={() => setEditName(true)} className="text-primary-600 hover:underline">
                Change
              </button>
            </p>
          ) : (
            <div>
              <label htmlFor="name" className="block text-sm font-medium">
                Your name <span className="font-normal text-secondary-500">(optional)</span>
              </label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" className={field} />
            </div>
          )}

          {showNote ? (
            <div>
              <label htmlFor="note" className="block text-sm font-medium">
                Note for the shop
              </label>
              <textarea id="note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
            </div>
          ) : (
            <button type="button" onClick={() => setShowNote(true)} className="text-sm text-primary-600 hover:underline">
              + Add a note for the shop
            </button>
          )}
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
          {unavailable.length > 0 && <p className="rounded-md bg-warning-50 p-2 text-xs text-warning-700">No longer available and left out: {unavailable.join(", ")}.</p>}
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
            disabled={busy || lines.length === 0 || !paymentPhone.trim() || !deliveryReady}
            className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? "Placing order..." : shop.practice ? `Place practice order (${kes(amountDue)})` : `Pay ${kes(amountDue)}`}
          </button>
        </aside>
      </form>
    </div>
  );
}
