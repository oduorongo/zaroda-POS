"use client";

import { ThemeToggle } from "@zaroda/ui";
import { posUrl } from "../../lib/product";

const BRAND = { navy: "#0f1f45", gold: "#d4af37", orange: "#f5820a" };
const host = (v?: string) => (v ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
/** A product's own address, or its pages on this address when it has none (locally). */
const landing = (domain: string | undefined, local: string) => (host(domain) ? `https://${host(domain)}/` : local);

const APPS = [
  {
    name: "Shop",
    what: "Point of sale for shops, supermarkets, hotels, restaurants, salons and online shops.",
    href: process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.zarodashop.com",
  },
  {
    name: "Build",
    what: "Construction: projects, BQs, valuations, site stores, labour and compliance.",
    href: landing(process.env.NEXT_PUBLIC_CONSTRUCTION_DOMAIN, "/construction/welcome?product=construction"),
  },
  {
    name: "Shamba",
    what: "Farms: animals, milk and eggs, crops, feed, workers and selling produce.",
    href: landing(process.env.NEXT_PUBLIC_SHAMBA_DOMAIN, "/shamba/welcome?product=shamba"),
  },
  {
    name: "Rentals",
    what: "Landlords: units, tenants, rent invoices, M-Pesa rent and short stays.",
    href: landing(process.env.NEXT_PUBLIC_RENTALS_DOMAIN, "/rentals/welcome?product=rentals"),
  },
];

/** Where the installed ZARODA app opens: every ZARODA app, and the one sign-in for all of them. Served on every address. */
export default function AppsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b-[3px] text-white" style={{ background: BRAND.navy, borderColor: BRAND.gold }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zaroda-logo-white.png" alt="Zaroda" className="h-10 w-auto" />
          <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">ZARODA apps</h1>
        <p className="mt-1 text-sm text-secondary-500">One sign-in for every ZARODA business. Pick an app to see what it does, or sign in to yours.</p>
        <a
          href={posUrl("/login")}
          className="mt-5 block rounded-xl p-4 text-center text-lg font-semibold text-white no-underline"
          style={{ background: BRAND.orange }}
        >
          Sign in to my business
        </a>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {APPS.map((a) => (
            <a key={a.name} href={a.href} className="block rounded-xl border border-border bg-surface p-5 text-foreground no-underline shadow-sm hover:border-[#d4af37]">
              <p className="text-lg font-extrabold">
                ZARODA <span style={{ color: BRAND.gold }}>{a.name}</span>
              </p>
              <p className="mt-1 text-sm text-secondary-500">{a.what}</p>
              <p className="mt-3 text-sm font-semibold" style={{ color: BRAND.orange }}>Open {a.name} →</p>
            </a>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-secondary-500">
          Cashiers: open the till at{" "}
          <a href={process.env.NEXT_PUBLIC_TERMINAL_URL ?? "https://pos.zarodashop.com"} className="underline">
            {host(process.env.NEXT_PUBLIC_TERMINAL_URL ?? "https://pos.zarodashop.com")}
          </a>
          .
        </p>
      </main>
    </div>
  );
}
