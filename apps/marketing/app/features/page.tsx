import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@zaroda/ui";
import CapabilityGrid from "../../components/capability-grid";
import { FeatureIllustration, type IllustrationKey } from "../../components/feature-illustrations";

export const metadata: Metadata = {
  title: "Features — Zaroda POS",
  description: "Offline-first checkout, M-Pesa STK push, multi-branch reporting, and staff accountability — everything a Kenyan shop needs from one till.",
  alternates: { canonical: "https://zarodashop.com/features" },
};

type Tone = "primary" | "accent" | "secondary" | "warning" | "success" | "error";

const CAPABILITIES: { title: string; description: string; illustration: IllustrationKey; tone: Tone }[] = [
  {
    title: "Offline-first terminal",
    description:
      "The till keeps ringing up sales even when the connection drops. Every sale is stored locally and syncs automatically the moment connectivity returns — no lost transactions, no waiting on a signal to serve a customer.",
    illustration: "pos",
    tone: "primary",
  },
  {
    title: "M-Pesa checkout",
    description:
      "STK push is built into the checkout flow, not bolted on. A cashier taps M-Pesa, the customer enters their PIN on their own phone, and the sale confirms itself — cash, M-Pesa, and card side by side on the same screen.",
    illustration: "mpesa",
    tone: "accent",
  },
  {
    title: "Inventory & stock-takes",
    description:
      "Track stock levels per branch, log stock-takes to catch shrinkage early, and get ahead of running out with visibility into what's moving and what isn't — down to the SKU.",
    illustration: "inventory",
    tone: "primary",
  },
  {
    title: "Multi-branch dashboard",
    description:
      "Sales, stock, and staff performance from every branch roll up into one back office. Compare branches side by side without asking anyone to send a report.",
    illustration: "branches",
    tone: "secondary",
  },
  {
    title: "Staff PIN accountability",
    description:
      "Every cashier signs in with their own PIN on shared terminals. Discounts, voids, and refunds are all logged to the person who approved them, so shrinkage has a name attached to it.",
    illustration: "staff",
    tone: "error",
  },
  {
    title: "Reporting",
    description:
      "Daily sales, VAT breakdowns, and staff activity in one place — the numbers you need for KRA compliance and for knowing how the shop is actually doing, without exporting spreadsheets by hand.",
    illustration: "reporting",
    tone: "primary",
  },
];

export default function FeaturesPage() {
  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Built for how Kenyan shops actually run</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-secondary-500">
          A single POS that keeps working when the internet doesn&apos;t, takes M-Pesa at the till, and gives you
          one dashboard across every branch.
        </p>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="space-y-6">
            {CAPABILITIES.map((c, idx) => (
              <Card key={c.title}>
                <CardContent className="grid gap-6 sm:grid-cols-3 sm:items-center">
                  <div className={`sm:col-span-2 ${idx % 2 === 1 ? "sm:order-2" : ""}`}>
                    <h2 className="text-xl font-semibold text-foreground">{c.title}</h2>
                    <p className="mt-2 text-secondary-500">{c.description}</p>
                  </div>
                  <FeatureIllustration
                    illustration={c.illustration}
                    tone={c.tone}
                    className={`h-40 rounded-lg ${idx % 2 === 1 ? "sm:order-1" : ""}`}
                    iconClassName="h-16 w-16"
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <div className="border-t border-border">
        <CapabilityGrid />
      </div>

      <section className="border-t border-border bg-surface py-16 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-foreground">See it running on your own till</h2>
          <p className="mt-2 text-secondary-500">14-day free trial, no card required.</p>
          <Link href="/signup" className="mt-6 inline-block rounded-md bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700">
            Start free trial
          </Link>
        </div>
      </section>
    </main>
  );
}
