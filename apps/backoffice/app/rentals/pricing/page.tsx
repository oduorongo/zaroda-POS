"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RentalsFrame } from "../../../components/rentals/public-frame";
import { RENTAL_FEATURE_LABELS, RENTALS_BRAND, type RentalPlan } from "../../../lib/rentals";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/** ZARODA RENTALS plans, from the API's price list (RENTALS_DOMAIN "/pricing"). */
export default function RentalsPricing() {
  const [plans, setPlans] = useState<RentalPlan[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/public/rental-plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPlans)
      .catch(() => setError(true));
  }, []);
  return (
    <RentalsFrame>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold" style={{ color: "var(--con-ink)" }}>Pricing</h1>
        <p className="mt-2 text-secondary-600">Start free and move up when you grow. Your tenants never pay anything to use the portal.</p>
        {error && <p className="mt-6 text-sm text-red-700">Could not load the plans right now.</p>}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {plans?.map((p) => (
            <div key={p.code} className="flex flex-col rounded-xl border-2 bg-surface p-5" style={{ borderColor: p.code === "starter" ? RENTALS_BRAND.gold : "transparent", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
              <h2 className="text-lg font-bold">{p.name}</h2>
              <p className="mt-2 text-2xl font-bold">{p.feePercent > 0 ? `${p.feePercent}% of rent collected` : p.monthlyPrice === 0 ? "Free" : kes(p.monthlyPrice)}</p>
              <p className="text-xs text-secondary-500">{p.feePercent > 0 ? "no monthly fee" : p.monthlyPrice === 0 ? "for ever" : `per month${p.annualPrice ? ` · ${kes(p.annualPrice)}/year` : ""}`}</p>
              <ul className="mt-3 space-y-1 text-sm">
                <li>{p.unitLimit === null ? "Unlimited units" : `Up to ${p.unitLimit} occupied units`}</li>
                <li>{p.caretakerLimit ? `${p.caretakerLimit} caretaker login${p.caretakerLimit === 1 ? "" : "s"}` : "No caretaker logins"}</li>
              </ul>
              <ul className="mt-3 flex-1 space-y-1 text-xs text-secondary-600">
                {p.features.map((f) => <li key={f}>✓ {RENTAL_FEATURE_LABELS[f] ?? f}</li>)}
                {p.features.length === 0 && <li>Properties, units, tenants, leases and invoices</li>}
              </ul>
              <Link href="/rentals/signup" className="mt-4 rounded-lg px-4 py-2 text-center text-sm font-semibold text-white no-underline" style={{ background: RENTALS_BRAND.orange }}>
                {p.monthlyPrice === 0 && p.feePercent === 0 ? "Start free" : "Start"}
              </Link>
            </div>
          ))}
        </div>
      </main>
    </RentalsFrame>
  );
}
