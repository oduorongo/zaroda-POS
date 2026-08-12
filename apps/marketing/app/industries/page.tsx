import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent, Badge } from "@zaroda/ui";

export const metadata: Metadata = {
  title: "Industries — Zaroda POS",
  description: "Dedicated POS setups for retail, restaurants, pharmacies, and salons in Kenya — each with the screens and workflow their trade needs.",
  alternates: { canonical: "https://zarodashop.com/industries" },
};

const INDUSTRIES = [
  {
    name: "Retail & supermarkets",
    tagline: "Supermarkets, minimarts, hardware, electronics, agrovets, wines & spirits",
    description:
      "Barcode-driven checkout, stock tracking, and multi-branch reporting for every kind of shop counter — from a neighborhood minimart to a multi-branch supermarket.",
  },
  {
    name: "Restaurants",
    tagline: "Eateries and restaurants",
    description:
      "Order-to-till checkout built for a fast counter — ring up orders, take M-Pesa or cash, and keep the till moving during a lunch rush.",
  },
  {
    name: "Pharmacies",
    tagline: "Pharmacies",
    description:
      "Fast checkout with the accountability a pharmacy till needs — every discount and refund logged to the staff member who approved it.",
  },
  {
    name: "Salons & spas",
    tagline: "Salons and spas",
    description:
      "Simple service-based checkout with staff PINs, so every till transaction on a shared terminal is tied to the person who rang it up.",
  },
];

export default function IndustriesPage() {
  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">One POS, built for your trade</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-secondary-500">
          Zaroda POS adapts its checkout and reporting to the kind of business you run — not a generic till
          forced onto every counter.
        </p>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-6 sm:grid-cols-2">
            {INDUSTRIES.map((ind) => (
              <Card key={ind.name}>
                <CardContent>
                  <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-surface p-6">
                    <Image src="/placeholder.svg" alt="" width={400} height={300} className="h-auto w-full max-w-[260px]" unoptimized />
                  </div>
                  <div className="mt-4">
                    <Badge variant="neutral">{ind.tagline}</Badge>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">{ind.name}</h2>
                    <p className="mt-2 text-secondary-500">{ind.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface py-16 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-foreground">Not sure where your shop fits?</h2>
          <p className="mt-2 text-secondary-500">Start the trial and pick your business type in a couple of taps — you can always adjust it later.</p>
          <Link href="/signup" className="mt-6 inline-block rounded-md bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700">
            Start free trial
          </Link>
        </div>
      </section>
    </main>
  );
}
