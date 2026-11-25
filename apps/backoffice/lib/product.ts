"use client";

/**
 * Which product this browser tab is: the POS back office, Construction or ZARODA RENTALS (docs/construction/06-domain-routing.md,
 * docs/rentals/domain-routing.md). middleware.ts works it out from the host and leaves it in the zaroda_product cookie. Domains come
 * from env only.
 */
export type Product = "POS" | "CONSTRUCTION" | "RENTALS" | "SHAMBA";

export const PRODUCT_COOKIE = "zaroda_product";
const CONSTRUCTION_DOMAIN = process.env.NEXT_PUBLIC_CONSTRUCTION_DOMAIN ?? "";
const RENTALS_DOMAIN = process.env.NEXT_PUBLIC_RENTALS_DOMAIN ?? "";
const SHAMBA_DOMAIN = process.env.NEXT_PUBLIC_SHAMBA_DOMAIN ?? "";
const POS_DOMAIN = process.env.NEXT_PUBLIC_POS_DOMAIN ?? "";

export function currentProduct(): Product {
  if (typeof document === "undefined") return "POS";
  const value = document.cookie.split("; ").find((c) => c.startsWith(`${PRODUCT_COOKIE}=`))?.split("=")[1];
  return value === "CONSTRUCTION" || value === "RENTALS" || value === "SHAMBA" ? value : "POS";
}

const absolute = (domain: string, path: string) => `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}${path}`;

/** A construction page's address on CONSTRUCTION_DOMAIN, or the same path here when no domain is set (one-domain setups, localhost). */
export const constructionUrl = (path: string) => (CONSTRUCTION_DOMAIN ? absolute(CONSTRUCTION_DOMAIN, path) : path);
/** A ZARODA RENTALS page's address on RENTALS_DOMAIN, or the same path here when no domain is set. */
export const rentalsUrl = (path: string) => (RENTALS_DOMAIN ? absolute(RENTALS_DOMAIN, path) : path);
/** A Zaroda Shamba page's address on SHAMBA_DOMAIN, or the same path here when no domain is set. */
export const shambaUrl = (path: string) => (SHAMBA_DOMAIN ? absolute(SHAMBA_DOMAIN, path) : path);
export const hasShambaDomain = () => !!SHAMBA_DOMAIN;
export const posUrl = (path: string) => (POS_DOMAIN ? absolute(POS_DOMAIN, path) : path);
export const hasConstructionDomain = () => !!CONSTRUCTION_DOMAIN;

const bare = (domain: string) => domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** The address a product's screens live on when there is no main address: /shamba on SHAMBA_DOMAIN, and so on. */
const productDomain = (path: string) =>
  path === "/shamba" || path.startsWith("/shamba/") ? SHAMBA_DOMAIN : path === "/rentals" || path.startsWith("/rentals/") ? RENTALS_DOMAIN : path === "/construction" || path.startsWith("/construction/") ? CONSTRUCTION_DOMAIN : "";

/**
 * After signing in or up: everyone works on the main address (POS_DOMAIN), so hand the new session over there through /auth/callback
 * (token in the URL hash, never sent to a server). Without a main address, a person whose home belongs to another product (a farm
 * signing in on the Build address) is handed to that product's own address the same way. Otherwise carry on here.
 */
export function openApp(path: string, token: string, email: string, go: (path: string) => void) {
  const main = bare(POS_DOMAIN);
  const own = bare(productDomain(path));
  const target = main || own;
  if (target && window.location.host !== target) window.location.href = `https://${target}/auth/callback#${new URLSearchParams({ token, email })}`;
  else go(path);
}
export const hasRentalsDomain = () => !!RENTALS_DOMAIN;
