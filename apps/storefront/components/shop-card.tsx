"use client";

import Link from "next/link";
import { MapPin, Store, Truck } from "lucide-react";
import { locationLabel } from "../lib/format";
import { useMyCounty } from "../lib/my-county";
import { distanceKm, kmLabel, reachFor, useMyLocation } from "../lib/my-location";
import type { ShopSummary } from "../lib/types";

export default function ShopCard({ shop }: { shop: ShopSummary }) {
  const place = shop.area || locationLabel(shop.subCounty, shop.county);
  const [myCounty] = useMyCounty();
  const { spot } = useMyLocation();
  const km = spot && shop.lat != null && shop.lng != null ? distanceKm(spot, { lat: shop.lat, lng: shop.lng }) : null;
  const reach = reachFor(shop, spot, myCounty);
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
          {(place || km !== null) && (
            <span className="flex items-center gap-1">
              <MapPin size={12} aria-hidden /> {[place, km !== null ? kmLabel(km) : null].filter(Boolean).join(" · ")}
            </span>
          )}
          <span>
            {shop.productCount} {shop.productCount === 1 ? "product" : "products"}
          </span>
          {shop.deliveryEnabled && (
            <span className={`flex items-center gap-1 ${reach.delivers === true ? "font-medium text-success-600" : reach.delivers === false ? "text-warning-700" : ""}`}>
              <Truck size={12} aria-hidden /> {reach.label}
              {reach.delivers === false && shop.pickupEnabled ? " - pickup only" : ""}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
