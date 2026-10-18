"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingCart, Trash2 } from "lucide-react";
import { formatQty, kes } from "../lib/format";
import { useStore } from "./store-provider";

/** Cart total in shillings, rounded the way the order will be charged (whole shillings, rounded up). */
export function cartTotals(lines: { price: number; quantity: number }[]) {
  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.price * l.quantity, 0) * 100) / 100;
  return { subtotal, amountDue: Math.ceil(subtotal) };
}

/**
 * Desktop: a sticky side panel listing the cart. Mobile: a bottom bar with
 * the count and total that goes straight to checkout.
 */
export default function CartSummary({ shopSlug }: { shopSlug: string }) {
  const { cartFor, setLineQuantity, ready } = useStore();
  const lines = cartFor(shopSlug);
  const { amountDue } = cartTotals(lines);
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
              <div className="mt-4 flex justify-between border-t border-border pt-3 font-semibold">
                <span>Total</span>
                <span>{kes(amountDue)}</span>
              </div>
              <Link
                href={checkoutHref}
                className="mt-4 block rounded-md bg-primary-600 px-4 py-3 text-center font-semibold text-white hover:bg-primary-700"
              >
                Checkout
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
            <span>Checkout - {kes(amountDue)}</span>
          </Link>
        </div>
        </>
      )}
    </>
  );
}
