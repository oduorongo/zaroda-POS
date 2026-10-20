"use client";

import Link from "next/link";
import { MapPin, Store, Truck } from "lucide-react";
import { locationLabel } from "../lib/format";
import { useMyCounty } from "../lib/my-county";
import type { ShopSummary } from "../lib/types";

export default function ShopCard({ shop }: { shop: ShopSummary }) {
  const location = locationLabel(shop.subCounty, shop.county);
  const [myCounty] = useMyCounty();
  // Whether this shop can deliver to the county the shopper said they are in (unknown = no answer to give).
  const reaches = !shop.deliveryEnabled || !myCounty || shop.deliveryCounties === null ? null : shop.deliveryCounties.includes(myCounty);
  return (
    <Link
      href={`/s/${shop.slug}`}
      className="group overflow-hidden rounded-lg border border-border bg-surface transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="aspect-[16/9] bg-secondary-500/10">
        {shop.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shop.coverImage} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-secondary-400">
            <Store size={36} aria-hidden />
          </div>
        )}
      </div>
      <div className="space-y-1.5 p-4">
        <h3 className="font-semibold group-hover:text-primary-600">{shop.name}</h3>
        {shop.description && <p className="line-clamp-2 text-sm text-secondary-500">{shop.description}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-secondary-500">
          {location && (
            <span className="flex items-center gap-1">
              <MapPin size={12} aria-hidden /> {location}
            </span>
          )}
          <span>{shop.productCount} {shop.productCount === 1 ? "product" : "products"}</span>
          {shop.deliveryEnabled && reaches !== false && (
            <span className={`flex items-center gap-1 ${reaches ? "font-medium text-success-600" : ""}`}>
              <Truck size={12} aria-hidden /> {reaches ? `Delivers to ${myCounty}` : "Delivers"}
            </span>
          )}
          {shop.deliveryEnabled && reaches === false && (
            <span className="flex items-center gap-1 text-warning-700">
              <Truck size={12} aria-hidden /> No delivery to {myCounty}
              {shop.pickupEnabled ? " - pickup only" : ""}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
