"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingCart, Trash2 } from "lucide-react";
import { formatQty, kes } from "../lib/format";
import { useStore } from "./store-provider";

/**
 * Cart total in shillings, worked out the way the order will be charged: the items rounded up to a whole shilling, plus the
 * shop's convenience fee (a percentage of the items, rounded to the nearest shilling) when it has one. Table orders pass no rate.
 */
export function cartTotals(lines: { price: number; quantity: number }[], feeRate = 0) {
  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.price * l.quantity, 0) * 100) / 100;
  const fee = subtotal > 0 && feeRate > 0 ? Math.round(subtotal * feeRate) : 0;
  return { subtotal, items: Math.ceil(subtotal), fee, amountDue: Math.ceil(subtotal) + fee };
}

/** "3%" - the rate as people say it. */
export const percentLabel = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

/**
 * Desktop: a sticky side panel listing the cart. Mobile: a bottom bar with
 * the count and total that goes straight to payment.
 */
export default function CartSummary({ shopSlug, feeRate = 0 }: { shopSlug: string; feeRate?: number }) {
  const { cartFor, setLineQuantity, ready } = useStore();
  const lines = cartFor(shopSlug);
  const { amountDue, items: itemsTotal, fee } = cartTotals(lines, feeRate);
  const count = lines.length;
  const checkoutHref = `/s/${shopSlug}/checkout`;

  // The page's bottom ribbon is sticky, sits above this bar (z-40) and changes height as its text wraps, so a bar
  // pinned to bottom-0 ends up hidden behind it on phones. Measure the ribbon and sit just above it instead.
  const [ribbonHeight, setRibbonHeight] = useState(0);
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;
    const update = () => setRibbonHeight(footer.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  if (!ready) return <aside className="hidden lg:block" />;

  return (
    <>
      <aside className="hidden lg:block" aria-label="Your cart">
        <div className="sticky top-20 rounded-lg border border-border bg-surface p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShoppingCart size={18} aria-hidden /> Your cart
          </h2>
          {count === 0 ? (
            <p className="mt-3 text-sm text-secondary-500">Nothing here yet. Add something you like.</p>
          ) : (
            <>
              <ul className="mt-3 space-y-3">
                {lines.map((l) => (
                  <li key={l.variantId} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.productName}</p>
                      <p className="text-xs text-secondary-500">
                        {formatQty(l.quantity)} x {kes(l.price)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{kes(Math.round(l.price * l.quantity * 100) / 100)}</span>
                      <button
                        onClick={() => setLineQuantity(shopSlug, l, 0)}
                        aria-label={`Remove ${l.productName}`}
                        className="text-secondary-400 hover:text-error-600"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {fee > 0 && (
                <div className="mt-4 space-y-1 border-t border-border pt-3 text-sm text-secondary-600">
                  <div className="flex justify-between">
                    <span>Items</span>
                    <span>{kes(itemsTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Convenience fee ({percentLabel(feeRate)})</span>
                    <span>{kes(fee)}</span>
                  </div>
                </div>
              )}
              <div className={`flex justify-between pt-3 font-semibold ${fee > 0 ? "" : "mt-4 border-t border-border"}`}>
                <span>Total</span>
                <span>{kes(amountDue)}</span>
              </div>
              <Link
                href={checkoutHref}
                className="mt-4 block rounded-md bg-primary-600 px-4 py-3 text-center font-semibold text-white hover:bg-primary-700"
              >
                Pay now
              </Link>
            </>
          )}
        </div>
      </aside>

      {count > 0 && (
        <>
          {/* Keeps the last products from sitting underneath the bar. */}
          <div aria-hidden className="h-20 lg:hidden" />
        <div
          style={{ bottom: ribbonHeight }}
          className="fixed inset-x-0 z-30 border-t border-border bg-surface p-3 shadow-[0_-4px_12px_rgba(15,23,42,0.12)] lg:hidden"
        >
          <Link
            href={checkoutHref}
            className="flex items-center justify-between rounded-md bg-primary-600 px-4 py-3 font-semibold text-white"
          >
            <span>
              {count} {count === 1 ? "item" : "items"} in cart
            </span>
            <span>Pay now - {kes(amountDue)}</span>
          </Link>
        </div>
        </>
      )}
    </>
  );
}
