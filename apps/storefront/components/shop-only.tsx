"use client";

import { usePathname } from "next/navigation";

/** "/schools/<slug>" when the page is one of a supplier's school pages (sign-in, joining form, printouts), else null. */
export function schoolHome(pathname: string | null): string | null {
  const m = pathname?.match(/^\/schools\/([^/]+)/);
  return m ? `/schools/${m[1]}` : null;
}

/** Marketplace extras (install prompt, shopper alerts, rider and tenant links) that a school on its supplier's link should not see. */
export default function ShopOnly({ children }: { children: React.ReactNode }) {
  return schoolHome(usePathname()) ? null : <>{children}</>;
}
