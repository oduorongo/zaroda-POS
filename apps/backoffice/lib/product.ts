"use client";

/**
 * Which product this browser tab is: the POS back office or Construction (docs/construction/06-domain-routing.md).
 * middleware.ts works it out from the host and leaves it in the zaroda_product cookie. Domains come from env only.
 */
export type Product = "POS" | "CONSTRUCTION";

export const PRODUCT_COOKIE = "zaroda_product";
const CONSTRUCTION_DOMAIN = process.env.NEXT_PUBLIC_CONSTRUCTION_DOMAIN ?? "";
const POS_DOMAIN = process.env.NEXT_PUBLIC_POS_DOMAIN ?? "";

export function currentProduct(): Product {
  if (typeof document === "undefined") return "POS";
  return document.cookie.split("; ").some((c) => c === `${PRODUCT_COOKIE}=CONSTRUCTION`) ? "CONSTRUCTION" : "POS";
}

const absolute = (domain: string, path: string) => `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}${path}`;

/** A construction page's address on CONSTRUCTION_DOMAIN, or the same path here when no domain is set (one-domain setups, localhost). */
export const constructionUrl = (path: string) => (CONSTRUCTION_DOMAIN ? absolute(CONSTRUCTION_DOMAIN, path) : path);
export const posUrl = (path: string) => (POS_DOMAIN ? absolute(POS_DOMAIN, path) : path);
export const hasConstructionDomain = () => !!CONSTRUCTION_DOMAIN;
