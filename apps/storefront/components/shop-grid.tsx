"use client";

import { distanceKm, useMyLocation } from "../lib/my-location";
import type { ShopSummary } from "../lib/types";
import ShopCard from "./shop-card";

/** The shop directory: nearest first once the shopper has shared their location (shops without a map pin go last). */
export default function ShopGrid({ shops }: { shops: ShopSummary[] }) {
  const { spot } = useMyLocation();
  const far = Number.POSITIVE_INFINITY;
  const sorted = spot
    ? [...shops].sort(
        (a, b) =>
          (a.lat != null && a.lng != null ? distanceKm(spot, { lat: a.lat, lng: a.lng }) : far) - (b.lat != null && b.lng != null ? distanceKm(spot, { lat: b.lat, lng: b.lng }) : far),
      )
    : shops;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((shop) => (
        <ShopCard key={shop.slug} shop={shop} />
      ))}
    </div>
  );
}
