"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { Card, CardContent, ErrorState, LoadingState } from "@zaroda/ui";

interface Plan {
  tier: string;
  name: string;
  priceKes: string;
  billingPeriodDays: number;
  maxDevices: number;
  maxBranches: number;
}

const TAGLINES: Record<string, string> = {
  BASIC: "One till, one shop. Perfect for a single minimart or agrovet counter.",
  STANDARD: "A few registers, one branch — supermarkets and busier shops.",
  PREMIUM: "Multiple branches, full staff roster, and priority support.",
};

/** Pricing is fetched live from GET /public/plans - the same Plan rows platform-admin's Billing screen manages, never hardcoded twice. */
export default function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setPlans(await apiGet<Plan[]>("/public/plans"));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load pricing right now.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Simple, per-device pricing</h1>
        <p className="mt-2 text-secondary-500">Pay monthly in KES. Cancel anytime. No setup fee.</p>
      </div>

      {loading && <div className="mt-12"><LoadingState label="Loading pricing..." /></div>}
      {!loading && error && <div className="mt-12"><ErrorState description={error} /></div>}

      {!loading && !error && (
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {plans.map((plan, i) => (
            <Card key={plan.tier} className={i === 1 ? "border-primary-500 shadow-lg" : undefined}>
              <CardContent>
                {i === 1 && (
                  <p className="mb-2 inline-block rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-primary-700">
                    Most popular
                  </p>
                )}
                <h2 className="text-lg font-bold text-foreground">{plan.name}</h2>
                <p className="mt-2 text-3xl font-bold text-foreground">
                  KES {Number(plan.priceKes).toLocaleString()}
                  <span className="text-sm font-normal text-secondary-500">/{plan.billingPeriodDays === 30 ? "mo" : `${plan.billingPeriodDays}d`}</span>
                </p>
                <p className="mt-2 text-sm text-secondary-500">{TAGLINES[plan.tier] ?? ""}</p>
                <ul className="mt-4 space-y-2 text-sm text-secondary-600">
                  <li>✓ Up to {plan.maxDevices} device{plan.maxDevices > 1 ? "s" : ""}</li>
                  <li>✓ Up to {plan.maxBranches} branch{plan.maxBranches > 1 ? "es" : ""}</li>
                  <li>✓ M-Pesa STK push</li>
                  <li>✓ Offline-capable terminal</li>
                  <li>✓ Free 14-day trial</li>
                </ul>
                <Link
                  href="/signup"
                  className="mt-6 block rounded-md bg-primary-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-primary-700"
                >
                  Start free trial
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
