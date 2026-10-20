"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, MapPin, Phone, Search } from "lucide-react";
import { locationLabel } from "../lib/format";
import type { Shop } from "../lib/types";
import CartSummary from "./cart-summary";
import ProductCard from "./product-card";

export default function ShopView({ shop, canReserve = false }: { shop: Shop; canReserve?: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

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
    </div>
  );
}
