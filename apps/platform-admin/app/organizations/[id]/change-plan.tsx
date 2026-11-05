"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch, ApiError } from "../../../lib/api";

interface PlanOption {
  tier: string;
  name: string;
  priceKes: string;
  maxDevices: number;
  maxBranches: number;
}

/** Moves the business to another device plan. Free plans never fall due; free to paid starts a 14-day trial. */
export function ChangePlan({ organizationId, currentTier, onChanged }: { organizationId: string; currentTier: string; onChanged: () => Promise<void> }) {
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [tier, setTier] = useState(currentTier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PlanOption[]>("/public/plans")
      .then((all) => setPlans(all.filter((p) => p.tier !== "SEASONAL")))
      .catch(() => setPlans([]));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/platform-admin/organizations/${organizationId}/plan`, { planTier: tier });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the plan.");
    } finally {
      setBusy(false);
    }
  }

  if (plans.length === 0 || currentTier === "SEASONAL") return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-secondary-500">Change plan</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-md border border-border bg-background p-1.5" value={tier} onChange={(e) => setTier(e.target.value)}>
          {plans.map((p) => (
            <option key={p.tier} value={p.tier}>
              {p.name} - KES {Number(p.priceKes).toLocaleString()} ({p.maxDevices} till{p.maxDevices === 1 ? "" : "s"}, {p.maxBranches} branch{p.maxBranches === 1 ? "" : "es"})
            </option>
          ))}
        </select>
        <button
          onClick={() => void save()}
          disabled={busy || tier === currentTier}
          className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-40"
        >
          {busy ? "..." : "Change plan"}
        </button>
      </div>
      <p className="mt-1 text-xs text-secondary-500">
        Onto a free plan: nothing falls due. From a free plan to a paid one: a 14-day trial first. Between paid plans: the next payment is at the new price.
        Tills and branches already set up keep working; only adding more is limited.
      </p>
      {error && <p className="mt-1 text-xs text-error-600">{error}</p>}
    </div>
  );
}
