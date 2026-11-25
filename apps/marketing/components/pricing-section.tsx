"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@zaroda/ui";

type Billing = "annual" | "monthly";

export const PRICING_PLANS = [
  {
    id: "basic",
    name: "Basic",
    blurb: "One till, one shop. Perfect for a single minimart or agrovet counter.",
    monthly: 1000,
    annual: 10000,
    instalments: "or 3 instalments of KES 3,500",
    features: ["1 device", "1 branch", "M-Pesa STK push", "Offline-capable terminal"],
  },
  {
    id: "standard",
    name: "Standard",
    popular: true,
    blurb: "A few registers, one branch — supermarkets and busier shops.",
    monthly: 3500,
    annual: 35000,
    instalments: "or 3 instalments of KES 12,000",
    features: ["Up to 3 devices", "1 branch", "M-Pesa STK push", "Offline-capable terminal"],
  },
  {
    id: "business",
    name: "Business",
    blurb: "Growing businesses running more than one outlet.",
    monthly: 7500,
    annual: 75000,
    instalments: "or 4 instalments of KES 19,500",
    features: ["Up to 10 devices", "Up to 3 branches", "M-Pesa STK push", "Offline-capable terminal"],
  },
  {
    id: "school-supplier",
    name: "School Supplier",
    blurb: "For suppliers to schools: one yearly fee, paid half in Term 1 and the rest by Term 2, or all at once.",
    monthly: null,
    annual: 12000,
    instalments: "or 2 termly instalments of KES 6,000",
    features: ["Up to 2 devices", "1 branch", "M-Pesa STK push", "Offline-capable terminal"],
  },
] as const;

const kes = (n: number) => "KES " + n.toLocaleString("en-KE");

/** The plans with an Annual / Monthly toggle. "Start free trial" opens sign-up with the plan and billing chosen. */
export default function PricingSection() {
  const [billing, setBilling] = useState<Billing>("annual");

  const toggleBtn = (b: Billing, label: string) => (
    <button
      type="button"
      onClick={() => setBilling(b)}
      aria-pressed={billing === b}
      className={`rounded-full px-[22px] py-2.5 font-semibold transition-colors ${billing === b ? "bg-primary-600 text-white" : "text-foreground hover:bg-primary-600/10"}`}
    >
      {label}
    </button>
  );

  return (
    <section className="rounded-2xl bg-surface px-5 py-12">
      <div className="mb-8 text-center">
        <div className="inline-flex rounded-full border border-border bg-background p-1">
          {toggleBtn("annual", "Annual")}
          {toggleBtn("monthly", "Monthly")}
        </div>
        <p className="mt-2.5 text-secondary-500">
          Pay yearly and get <b className="text-foreground">2 months free</b> + free setup and onboarding.
        </p>
      </div>

      <div className="mx-auto grid max-w-[1200px] gap-5 [grid-template-columns:repeat(auto-fit,minmax(250px,1fr))]">
        {PRICING_PLANS.map((p) => {
          const annualOnly = p.monthly === null;
          const showAnnual = billing === "annual" || annualOnly;
          const popular = "popular" in p && p.popular;
          return (
            <Card key={p.id} className={`flex flex-col rounded-2xl ${popular ? "border-2 border-primary-600 shadow-lg" : ""}`}>
              <CardContent className="flex flex-1 flex-col p-7">
                <div className="min-h-[28px]">
                  {popular && <span className="rounded-full bg-primary-600/10 px-3 py-1 text-sm text-foreground">Most popular</span>}
                  {showAnnual && !annualOnly && (
                    <span className={`rounded-full bg-[#d4af37] px-3 py-1 text-sm font-semibold text-[#0b1a3a] ${popular ? "ml-2" : ""}`}>Save 2 months</span>
                  )}
                </div>
                <h3 className="my-2.5 text-[22px] font-bold text-foreground">{p.name}</h3>

                <div className="text-[34px] font-extrabold text-foreground">
                  {kes(showAnnual ? p.annual : p.monthly!)}
                  <span className="text-base font-normal text-secondary-500">{showAnnual ? "/year" : "/mo"}</span>
                </div>
                <p className="mt-1.5 text-sm text-secondary-500">
                  {showAnnual
                    ? annualOnly
                      ? p.instalments
                      : `${p.instalments} · or ${kes(p.monthly!)}/mo billed monthly`
                    : `Pay ${kes(p.annual)}/year and save ${kes(p.monthly! * 12 - p.annual)}`}
                </p>

                <p className="my-4 text-secondary-500">{p.blurb}</p>
                <ul className="mb-6 space-y-1 leading-8 text-secondary-600">
                  {[...p.features, "Free 14-day trial"].map((f) => (
                    <li key={f}>✓ {f}</li>
                  ))}
                </ul>

                <Link
                  href={`/signup?plan=${p.id}&billing=${showAnnual ? "annual" : "monthly"}`}
                  className="mt-auto rounded-[10px] bg-primary-600 p-3.5 text-center font-semibold text-white hover:bg-primary-700"
                >
                  Start free trial
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-center text-secondary-500">
        Need another till? Add one to any plan for {kes(500)}/mo or {kes(5000)}/year.
      </p>
    </section>
  );
}
