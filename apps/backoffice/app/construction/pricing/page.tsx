"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CON_BRAND, kes } from "../../../lib/construction";
import { PublicFrame } from "../../../components/construction/public-frame";

type Limits = { activeProjects: number | null; workers: number | null; users: number | null };
interface Plan { code: string; name: string; monthlyPrice: number; annualPrice: number | null; quoteOnly: boolean; setupFee: number | null; setupFeeOptional: boolean; limits: Limits; features: string[] }
interface Pricing { plans: Plan[]; features: Record<string, string>; trialDays: number; trialPlan: string }

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const limit = (n: number | null, what: string) => (n === null ? `Unlimited ${what}` : `${n} ${what}`);

export default function ConstructionPricing() {
  const [data, setData] = useState<Pricing | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/public/construction/plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <PublicFrame>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold" style={{ color: CON_BRAND.navy }}>Pricing</h1>
        <p className="mt-2 text-secondary-600">Every plan starts with a {data?.trialDays ?? 14}-day free trial - no M-Pesa needed. Pay annually and get 12 months for the price of 10. Client, consultant and subcontractor portal users are always free.</p>
        {error && <p className="mt-6 text-sm text-red-700">Could not load the plans right now.</p>}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {data?.plans.map((p) => (
            <div key={p.code} className="flex flex-col rounded-xl border-2 bg-surface p-5" style={{ borderColor: p.code === data.trialPlan ? CON_BRAND.gold : "transparent", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
              <h2 className="text-lg font-bold" style={{ color: CON_BRAND.navy }}>{p.name}</h2>
              <p className="mt-2 text-2xl font-bold">{p.quoteOnly ? "Quote" : kes(p.monthlyPrice)}</p>
              <p className="text-xs text-secondary-500">{p.quoteOnly ? `from ${kes(p.monthlyPrice)}/month` : `per month · ${p.annualPrice !== null ? `${kes(p.annualPrice)}/year` : ""}`}</p>
              <ul className="mt-3 space-y-1 text-sm">
                <li>{limit(p.limits.activeProjects, "active projects")}</li>
                <li>{limit(p.limits.workers, "workers")}</li>
                <li>{limit(p.limits.users, "staff users")}</li>
                {p.setupFee !== null && <li className="text-xs text-secondary-500">Setup {kes(p.setupFee)}{p.setupFeeOptional ? " (optional)" : ""}</li>}
              </ul>
              <ul className="mt-3 flex-1 space-y-1 text-xs text-secondary-600">
                {p.features.map((f) => <li key={f}>✓ {data.features[f] ?? f}</li>)}
              </ul>
              <Link href="/construction/signup" className="mt-4 rounded-lg px-4 py-2 text-center text-sm font-semibold text-white no-underline" style={{ background: p.quoteOnly ? CON_BRAND.navy : CON_BRAND.orange }}>
                {p.quoteOnly ? "Talk to us" : "Start free trial"}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-secondary-500">Extra active project: KES 1,500 per month on Fundi and above (Mjengo is one site - start a second and you move up to Fundi). Onboarding (importing workers, BQ and documents, plus training) is quoted per plan where no setup fee is shown.</p>
      </main>
    </PublicFrame>
  );
}
