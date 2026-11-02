"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@zaroda/ui";
import { RENTALS_BRAND } from "../../lib/rentals";

/** ZARODA RENTALS public pages (landing, pricing, sign-in, signup). Links use the paths middleware maps on RENTALS_DOMAIN. */
export function RentalsFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 text-white shadow" style={{ background: RENTALS_BRAND.navy, borderBottom: `3px solid ${RENTALS_BRAND.green}` }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/rentals/welcome" className="flex items-center gap-2 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zaroda-logo-white.png" alt="Zaroda" className="h-9 w-auto" />
            <span className="text-sm font-extrabold uppercase tracking-widest" style={{ color: RENTALS_BRAND.gold }}>Rentals</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/rentals/pricing" className="text-white/85 no-underline hover:text-white">Pricing</Link>
            <Link href="/rentals/login" className="text-white/85 no-underline hover:text-white">Sign in</Link>
            <Link href="/rentals/signup" className="rounded-md px-3 py-1.5 font-semibold no-underline" style={{ background: RENTALS_BRAND.green, color: "white" }}>
              Start free
            </Link>
            <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-border px-4 py-6 text-center text-xs text-secondary-500">
        {RENTALS_BRAND.name} · Powered by ZARODA SOLUTIONS
      </footer>
    </div>
  );
}
