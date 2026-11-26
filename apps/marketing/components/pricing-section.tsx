"use client";

import { useState } from "react";
import Link from "next/link";

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

const NAVY = "#0f1f45";
const GOLD = "#d4af37";
const ORANGE = "#f5820a";

/** The plans with an Annual / Monthly toggle, in fixed brand colours so it looks the same in light and dark mode. "Start free trial" opens sign-up with the plan and billing chosen. */
export default function PricingSection() {
  const [billing, setBilling] = useState<Billing>("annual");

  const toggleBtn = (b: Billing, label: string) => (
    <button
      type="button"
      onClick={() => setBilling(b)}
      aria-pressed={billing === b}
      className="rounded-full px-5 py-2 text-sm font-semibold transition-colors"
      style={billing === b ? { background: NAVY, color: "#fff" } : { color: NAVY }}
    >
      {label}
    </button>
  );

  return (
    <section className="rounded-2xl px-4 py-10 sm:px-6" style={{ background: "#f3f4f8", color: NAVY }}>
      <div className="mb-8 text-center">
        <div className="inline-flex rounded-full border border-slate-300 bg-white p-1">
          {toggleBtn("annual", "Annual")}
          {toggleBtn("monthly", "Monthly")}
        </div>
        <p className="mt-2.5 text-sm text-slate-500">
          Pay yearly and get <b style={{ color: NAVY }}>2 months free</b> + free setup and onboarding.
        </p>
      </div>

      <div className="mx-auto grid max-w-[1200px] gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRICING_PLANS.map((p) => {
          const annualOnly = p.monthly === null;
          const showAnnual = billing === "annual" || annualOnly;
          const popular = "popular" in p && p.popular;
          return (
            <div
              key={p.id}
              className="flex flex-col rounded-xl bg-white p-5 shadow-sm"
              style={{ border: popular ? `2px solid ${NAVY}` : "1px solid #e2e5ec" }}
            >
              <div className="flex min-h-[24px] flex-wrap gap-1.5">
                {popular && <span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-xs" style={{ color: NAVY }}>Most popular</span>}
                {showAnnual && !annualOnly && (
                  <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: GOLD, color: NAVY }}>Save 2 months</span>
                )}
              </div>
              <h3 className="mt-2 text-lg font-medium">{p.name}</h3>

              <div className="mt-3 whitespace-nowrap text-[28px] font-extrabold leading-tight">
                {kes(showAnnual ? p.annual : p.monthly!)}
                <span className="text-sm font-normal" style={{ color: ORANGE }}>{showAnnual ? "/year" : "/mo"}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {showAnnual ? (
                  annualOnly ? (
                    p.instalments
                  ) : (
                    <>
                      {p.instalments} · or <span style={{ color: ORANGE }}>{kes(p.monthly!)}/mo billed monthly</span>
                    </>
                  )
                ) : (
                  <>
                    Pay <span style={{ color: ORANGE }}>{kes(p.annual)}/year</span> and save {kes(p.monthly! * 12 - p.annual)}
                  </>
                )}
              </p>

              <p className="my-3 text-sm leading-6 text-slate-500">{p.blurb}</p>
              <ul className="mb-5 space-y-1 text-sm leading-7">
                {[...p.features, "Free 14-day trial"].map((f) => (
                  <li key={f}>
                    <span style={{ color: ORANGE }}>✓</span> {f}
                  </li>
                ))}
              </ul>

              <Link
                href={`/signup?plan=${p.id}&billing=${showAnnual ? "annual" : "monthly"}`}
                className="mt-auto rounded-lg p-3 text-center text-sm font-semibold text-white hover:opacity-90"
                style={{ background: NAVY }}
              >
                Start free trial
              </Link>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        Need another till? Add one to any plan for {kes(500)}/mo or {kes(5000)}/year.
      </p>
    </section>
  );
}
