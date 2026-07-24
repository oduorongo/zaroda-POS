import Link from "next/link";
import { Card, CardContent } from "@zaroda/ui";

const FEATURES = [
  {
    title: "M-Pesa built in",
    description: "STK push at the till, not a bolt-on. Cash, M-Pesa, and card in one checkout flow.",
  },
  {
    title: "Works without internet",
    description: "Sales complete offline and sync automatically when connectivity returns — never lose a sale to a dropped connection.",
  },
  {
    title: "eTIMS-ready",
    description: "VAT breakdown, KRA PIN, and tax-class management built in from day one — ready as KRA integration comes online.",
  },
  {
    title: "Theft-resistant by design",
    description: "Every discount, void, and refund is logged to who approved it. PIN-based cashier accountability on shared terminals.",
  },
  {
    title: "Multi-branch, one dashboard",
    description: "Stock, staff, and sales roll up across every branch — see the whole business from one back office.",
  },
  {
    title: "Built for your trade",
    description: "Supermarkets, minimarts, pharmacies, agrovets, hardware, electronics, wines & spirits — dedicated screens for each.",
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

      <section className="border-t border-border bg-surface py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-10 text-center text-2xl font-bold text-foreground">
            Everything a Kenyan shop actually needs
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Card key={f.title}>
                <CardContent>
                  <h3 className="font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-secondary-500">{f.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-foreground">Ready to see it on your own till?</h2>
        <p className="mt-2 text-secondary-500">Set up in minutes — your first branch and register are ready before your first sale.</p>
        <Link href="/signup" className="mt-6 inline-block rounded-md bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700">
          Start free trial
        </Link>
      </section>
    </main>
  );
}
