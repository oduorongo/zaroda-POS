"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CON_BRAND } from "../../lib/construction";

/** Construction's public pages (landing, pricing, login, signup). Links use the paths middleware maps on CONSTRUCTION_DOMAIN. */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="text-white" style={{ background: CON_BRAND.navy }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/construction/welcome" className="flex items-center gap-2 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zaroda-logo-white.png" alt="Zaroda" className="h-9 w-auto" />
            <span className="text-sm font-extrabold uppercase tracking-widest" style={{ color: CON_BRAND.gold }}>Build</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/construction/pricing" className="text-white/85 no-underline hover:text-white">Pricing</Link>
            <Link href="/construction/login" className="text-white/85 no-underline hover:text-white">Sign in</Link>
            <Link href="/construction/signup" className="rounded-md px-3 py-1.5 font-semibold no-underline" style={{ background: CON_BRAND.orange, color: "white" }}>
              Free trial
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
