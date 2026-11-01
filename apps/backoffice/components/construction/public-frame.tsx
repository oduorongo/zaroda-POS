"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@zaroda/ui";
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
            <Link href="/construction/guide" className="hidden text-white/85 no-underline hover:text-white sm:inline">Guide</Link>
            <Link href="/construction/login" className="text-white/85 no-underline hover:text-white">Sign in</Link>
            <Link href="/construction/signup" className="rounded-md px-3 py-1.5 font-semibold no-underline" style={{ background: CON_BRAND.orange, color: "white" }}>
              Free trial
            </Link>
            <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

/** A site photo beside a public form: a banner above it on a phone, the left half of the screen from lg up (photos in public/con-*.jpg). */
export function PhotoSplit({ photo, position = "center", title, text, children }: { photo: string; position?: string; title: string; text: string; children: ReactNode }) {
  return (
    <div className="lg:flex lg:min-h-[calc(100vh-3.75rem)]">
      <div className="relative flex h-48 items-end bg-cover sm:h-64 lg:h-auto lg:w-1/2" style={{ backgroundImage: `url(${photo})`, backgroundPosition: position, backgroundColor: CON_BRAND.navy }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(to top, ${CON_BRAND.navy}f0, ${CON_BRAND.navy}33 65%, transparent)` }} />
        <div className="relative p-5 text-white lg:p-10">
          <p className="text-xl font-bold leading-tight sm:text-2xl lg:text-3xl">{title}</p>
          <p className="mt-2 max-w-md text-sm text-white/85">{text}</p>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">{children}</div>
    </div>
  );
}
