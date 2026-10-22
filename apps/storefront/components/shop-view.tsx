"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, MapPin, Phone, ScanBarcode, Search } from "lucide-react";
import { formatQty, locationLabel, variantTitle } from "../lib/format";
import type { Shop } from "../lib/types";
import CartSummary from "./cart-summary";
import ProductCard from "./product-card";
import ShopScanner from "./shop-scanner";
import { useStore } from "./store-provider";

export default function ShopView({ shop, canReserve = false }: { shop: Shop; canReserve?: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const { cartFor, setLineQuantity } = useStore();
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const lastScan = useRef({ code: "", at: 0 });

  // A scanned code finds this shop's matching product (by barcode, else product code) and puts one in the cart. The camera
  // reads the same code many times a second, so a repeat within a couple of seconds is ignored; scanning it again later adds one more.
  function onScanned(raw: string) {
    const code = raw.trim().toLowerCase();
    const now = Date.now();
    if (!code || (lastScan.current.code === code && now - lastScan.current.at < 2500)) return;
    lastScan.current = { code, at: now };
    for (const product of shop.products) {
      const variant = product.variants.find((v) => v.barcode?.toLowerCase() === code) ?? product.variants.find((v) => v.sku.toLowerCase() === code);
      if (!variant) continue;
      const title = variantTitle(product.name, variant.name);
      const inCart = cartFor(shop.slug).find((l) => l.variantId === variant.id)?.quantity ?? 0;
      const step = variant.quantityMode === "WEIGHT" ? 0.5 : 1;
      if (variant.available <= 0) {
        setScanMessage(`${title} is sold out right now.`);
      } else if (inCart + step > variant.available) {
        setScanMessage(`You already have all ${formatQty(variant.available)} of ${title} that are left.`);
      } else {
        setLineQuantity(shop.slug, { variantId: variant.id, productName: title, sku: variant.sku, price: variant.price, quantityMode: variant.quantityMode }, Math.round((inCart + step) * 1000) / 1000);
        setScanMessage(`Added to your cart: ${title}. Scan another, or tap Done.`);
      }
      return;
    }
    setScanMessage("This shop does not sell that product (or has not put it online).");
  }

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of shop.products) if (p.category) seen.set(p.category.id, p.category.name);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [shop.products]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return shop.products.filter(
      (p) =>
        (!category || p.category?.id === category) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.description?.toLowerCase().includes(needle)),
    );
  }, [shop.products, query, category]);

  const location = shop.location ? locationLabel(shop.location.subCounty, shop.location.county) : "";
  const fulfilment = [shop.pickupEnabled && "Pickup", shop.deliveryEnabled && "Delivery"].filter(Boolean).join(" or ");

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <div>
        <Link href="/" className="text-sm text-primary-600 hover:underline">
          All shops
        </Link>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{shop.name}</h1>
        {shop.description && <p className="mt-2 max-w-2xl text-secondary-600">{shop.description}</p>}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-secondary-500">
          {location && (
            <span className="flex items-center gap-1">
              <MapPin size={14} aria-hidden /> {shop.location?.branchName}, {location}
            </span>
          )}
          {shop.contactPhone && (
            <a href={`tel:${shop.contactPhone}`} className="flex items-center gap-1 hover:text-primary-600">
              <Phone size={14} aria-hidden /> {shop.contactPhone}
            </a>
          )}
          {fulfilment && <span>{fulfilment}</span>}
          {canReserve && (
            <Link href={`/s/${shop.slug}/reserve`} className="flex items-center gap-1 font-medium text-primary-600 hover:underline">
              <CalendarClock size={14} aria-hidden /> Reserve a table
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-label="Products" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search this shop"
                aria-label="Search this shop"
                className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <button
              onClick={() => {
                setScanMessage(null);
                setScanOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-secondary-500/10"
            >
              <ScanBarcode size={16} aria-hidden /> Scan
            </button>
            {categories.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCategory(null)}
                  className={`rounded-full border px-3 py-1 text-sm ${!category ? "border-primary-600 bg-primary-600 text-white" : "border-border bg-surface"}`}
                >
                  All
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(category === c.id ? null : c.id)}
                    className={`rounded-full border px-3 py-1 text-sm ${category === c.id ? "border-primary-600 bg-primary-600 text-white" : "border-border bg-surface"}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-500">No products match.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((product) => (
                <ProductCard key={product.id} shopSlug={shop.slug} product={product} />
              ))}
            </div>
          )}
        </section>

        <CartSummary shopSlug={shop.slug} feeRate={shop.convenienceFeeRate} />
      </div>
      {scanOpen && <ShopScanner onDetected={onScanned} onClose={() => setScanOpen(false)} statusMessage={scanMessage} />}
    </div>
  );
}
