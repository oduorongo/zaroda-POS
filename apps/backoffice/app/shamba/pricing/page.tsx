"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShambaPublicFrame } from "../../../components/shamba/frame";
import { SHAMBA_BRAND, SHAMBA_INK, kes, limitText, type FarmPlan } from "../../../lib/shamba";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

const FEATURE_LABELS: [string, string][] = [
  ["livestock", "Animals, health and breeding"],
  ["production", "Milk and egg records"],
  ["crops", "Crops"],
  ["programmes", "Vaccination reminders by SMS"],
  ["feed", "Feed production"],
  ["sales_credit", "Credit buyers"],
  ["labour", "Casual workers and M-Pesa wages"],
  ["reports_full", "Full reports and downloads"],
  ["ledger", "Accounts"],
  ["multi_site", "Several farm sites"],
];

export default function ShambaPricing() {
  const [plans, setPlans] = useState<FarmPlan[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/public/farm-plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPlans, () => setError(true));
  }, []);

  return (
    <ShambaPublicFrame>
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-bold" style={{ color: SHAMBA_INK }}>Prices for every size of farm</h1>
        <p className="mt-2 text-secondary-600">Start free. Pay monthly by M-Pesa, or yearly and get 2 months free.</p>
        {error && <p className="mt-6 text-red-700">Prices could not be loaded. Try again shortly.</p>}
        {!plans && !error && <p className="mt-6 text-secondary-500">Loading...</p>}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {plans?.map((p) => (
            <div key={p.code} className="flex flex-col rounded-xl border border-border bg-surface p-5 shadow-sm">
              <h2 className="text-lg font-bold" style={{ color: SHAMBA_INK }}>{p.name}</h2>
              <p className="mt-2 text-2xl font-bold" style={{ color: SHAMBA_BRAND.orange }}>
                {p.quoteOnly ? "Ask us" : p.monthlyPrice === 0 ? "Free" : kes(p.monthlyPrice)}
                {!p.quoteOnly && p.monthlyPrice > 0 && <span className="text-sm font-normal text-secondary-500"> /month</span>}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-secondary-700">
                <li>{limitText(p.limits.head)} livestock</li>
                <li>{limitText(p.limits.birds)} birds</li>
                <li>{limitText(p.limits.acres)} acres</li>
                <li>{limitText(p.limits.users)} users</li>
              </ul>
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-secondary-600">
                {FEATURE_LABELS.filter(([k]) => p.features.includes(k)).map(([k, label]) => (
                  <li key={k}>✓ {label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-secondary-600">
          Every new farm gets 14 days of Farmer free.{" "}
          <Link href="/shamba/signup" className="font-semibold underline" style={{ color: SHAMBA_INK }}>
            Start now
          </Link>
          .
        </p>
      </main>
    </ShambaPublicFrame>
  );
}
