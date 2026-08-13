import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent, Badge } from "@zaroda/ui";
import CapabilityGrid from "../components/capability-grid";

export const metadata: Metadata = {
  title: "Zaroda POS — POS for Kenyan Retail",
  description: "Rent-to-run POS for Kenyan shops — M-Pesa STK push, offline sales, and eTIMS-ready tax from day one.",
  alternates: { canonical: "https://zarodashop.com" },
};

const INTEGRATIONS = [
  {
    name: "M-Pesa",
    description: "STK push straight from the till — customers pay on their own phone, the sale confirms itself.",
  },
  {
    name: "SMS & WhatsApp",
    description: "Receipts and low-stock alerts sent via Africa's Talking, no extra app for your staff or customers to install.",
  },
  {
    name: "eTIMS / KRA",
    description: "VAT and tax-class data captured on every sale, structured for eTIMS submission as your KRA integration goes live.",
  },
];

const STEPS = [
  {
    step: "1",
    title: "Sign up",
    description: "Create your account and first branch in a couple of minutes — no card required.",
  },
  {
    step: "2",
    title: "Set up your shop",
    description: "Add products, staff PINs, and pricing. Import your stock list or start from scratch.",
  },
  {
    step: "3",
    title: "Start selling",
    description: "Open the till on any tablet or phone. Sales sync automatically, online or off.",
  },
];

export default function LandingPage() {
  return (
    <main>
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          The POS your shop rents, not builds
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-secondary-500">
          M-Pesa, KES, and Kenyan retail from the ground up. No hardware to buy, no server to run —
          just a monthly fee and a tablet.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/signup" className="rounded-md bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700">
            Start your 14-day free trial
          </Link>
          <Link href="/pricing" className="rounded-md border border-border px-6 py-3 font-semibold text-foreground hover:bg-secondary-50">
            See pricing
          </Link>
        </div>
        <p className="mt-3 text-xs text-secondary-400">No card required to start.</p>
      </section>

      <section className="border-y border-border bg-surface py-8">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-wide text-secondary-400">
            Trusted by shops across Kenya
          </p>
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {["Retail shop", "Pharmacy", "Restaurant", "Hardware store"].map((label) => (
              <div
                key={label}
                className="flex h-16 items-center justify-center rounded-md border border-dashed border-border text-xs font-medium text-secondary-400"
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <CapabilityGrid />

      <section className="border-t border-border bg-surface py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="primary">Integrations</Badge>
            <h2 className="mt-3 text-2xl font-bold text-foreground">Connected to what Kenyan shops actually use</h2>
            <p className="mt-2 text-secondary-500">No middleman apps to set up — these run on the same account as your till.</p>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {INTEGRATIONS.map((i) => (
              <Card key={i.name}>
                <CardContent>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-500/10 text-sm font-bold text-accent-600">
                    {i.name.charAt(0)}
                  </div>
                  <h3 className="mt-3 font-semibold text-foreground">{i.name}</h3>
                  <p className="mt-1.5 text-sm text-secondary-500">{i.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-bold text-foreground">How it works</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.step} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 font-bold text-white">
                  {s.step}
                </div>
                <h3 className="mt-4 font-semibold text-foreground">{s.title}</h3>
                <p className="mt-1.5 text-sm text-secondary-500">{s.description}</p>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-12 flex max-w-3xl items-center justify-center rounded-lg border border-dashed border-border bg-surface p-10 text-sm text-secondary-400">
            <Image src="/placeholder.svg" alt="" width={400} height={300} className="h-auto w-full max-w-sm" unoptimized />
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface py-16 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-foreground">Ready to see it on your own till?</h2>
          <p className="mt-2 text-secondary-500">Set up in minutes — your first branch and register are ready before your first sale.</p>
          <Link href="/signup" className="mt-6 inline-block rounded-md bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700">
            Start free trial
          </Link>
        </div>
      </section>
    </main>
  );
}
