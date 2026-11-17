"use client";

import { useCallback, useEffect, useState } from "react";

export interface Spot {
  lat: number;
  lng: number;
}

const KEY = "zaroda_my_location";

const read = (): Spot | null => {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Spot | null;
    return value && typeof value.lat === "number" && typeof value.lng === "number" ? value : null;
  } catch {
    return null;
  }
};

/**
 * Where the shopper is, when they tapped "Use my location" (asked once, remembered on this phone). Used to list shops
 * nearest first and to check a shop that delivers within a distance; the shop checks it again when the order is placed.
 */
export function useMyLocation(): { spot: Spot | null; locating: boolean; error: string | null; locate: () => Promise<Spot | null>; forget: () => void } {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSpot(read());
    const onChange = () => setSpot(read());
    window.addEventListener("zaroda-location", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("zaroda-location", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const save = useCallback((next: Spot | null) => {
    try {
      if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
      else window.localStorage.removeItem(KEY);
    } catch {
      /* private window: not remembered */
    }
    setSpot(next);
    window.dispatchEvent(new Event("zaroda-location"));
  }, []);

  const locate = useCallback(
    () =>
      new Promise<Spot | null>((resolve) => {
        setError(null);
        if (!navigator.geolocation) {
          setError("This phone cannot share its location. Choose your county instead.");
          resolve(null);
          return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const next = { lat: Number(pos.coords.latitude.toFixed(5)), lng: Number(pos.coords.longitude.toFixed(5)) };
            save(next);
            setLocating(false);
            resolve(next);
          },
          () => {
            setError("Location was not shared. Allow location for this site, or choose your county instead.");
            setLocating(false);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5 * 60_000 },
        );
      }),
    [save],
  );

  return { spot, locating, error, locate, forget: () => save(null) };
}

/** Straight-line km between two points. */
export function distanceKm(a: Spot, b: Spot): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export const kmLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

interface ReachShop {
  deliveryEnabled: boolean;
  deliveryCounties: string[] | null;
  lat?: number | null;
  lng?: number | null;
  deliveryReach?: "COUNTIES" | "RADIUS" | "KENYA";
  deliveryRadiusKm?: number | null;
}

/** Whether a shop delivers to this shopper: yes / no / unknown (not enough to tell), with a short label. Mirrors the server's check. */
export function reachFor(shop: ReachShop, spot: Spot | null, county: string): { delivers: boolean | null; label: string } {
  if (!shop.deliveryEnabled) return { delivers: false, label: "Pickup only" };
  if (shop.deliveryReach === "KENYA") return { delivers: true, label: "Delivers anywhere in Kenya" };
  const pinned = shop.deliveryReach === "RADIUS" && shop.deliveryRadiusKm && shop.lat != null && shop.lng != null;
  if (pinned) {
    if (!spot) return { delivers: null, label: `Delivers within ${shop.deliveryRadiusKm} km` };
    const km = distanceKm(spot, { lat: shop.lat!, lng: shop.lng! });
    return km <= shop.deliveryRadiusKm! ? { delivers: true, label: "Delivers to you" } : { delivers: false, label: `Too far to deliver (${shop.deliveryRadiusKm} km)` };
  }
  if (!county || shop.deliveryCounties === null) return { delivers: null, label: "Delivers" };
  return shop.deliveryCounties.includes(county) ? { delivers: true, label: `Delivers to ${county}` } : { delivers: false, label: `No delivery to ${county}` };
}
