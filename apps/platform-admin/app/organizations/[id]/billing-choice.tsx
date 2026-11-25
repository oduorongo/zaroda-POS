"use client";

import { useState } from "react";
import { apiPatch, ApiError } from "../../../lib/api";

type Choice = "MONTHLY" | "ANNUAL" | "INSTALMENTS";

/** How the business pays: monthly, the year at once, or the year in instalments. Switching drops an old agreed price. */
export function BillingChoice({
  organizationId,
  plan,
  choice,
  bill,
  hasAgreedPrice,
  onChanged,
}: {
  organizationId: string;
  plan: { name: string; billingCycle?: string; priceKes: string; annualPriceKes?: string | null; instalmentCount?: number | null; instalmentKes?: string | null };
  choice: string;
  bill?: { amount: number; label: string };
  hasAgreedPrice: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (plan.billingCycle === "SEASONAL" || Number(plan.priceKes) === 0) return null;

  const kes = (v: unknown) => `KES ${Number(v).toLocaleString()}`;
  const options: { value: Choice; label: string }[] = [
    { value: "MONTHLY", label: `Monthly (${kes(plan.priceKes)})` },
    { value: "ANNUAL", label: `Yearly (${kes(plan.annualPriceKes ?? Number(plan.priceKes) * 12)})` },
    ...(plan.instalmentCount ? [{ value: "INSTALMENTS" as Choice, label: `Yearly in ${plan.instalmentCount} instalments (${plan.instalmentCount} × ${kes(plan.instalmentKes)})` }] : []),
  ];

  async function change(next: Choice) {
    if (next === choice) return;
    if (hasAgreedPrice && !window.confirm("This business is on an old agreed price. Switching moves it to the plan's new prices. Continue?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/platform-admin/organizations/${organizationId}/billing`, { billingChoice: next });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change how they pay.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-secondary-500">How they pay</p>
      <select value={choice} disabled={busy} onChange={(e) => void change(e.target.value as Choice)} className="w-full rounded-md border border-border bg-surface p-2.5 text-sm sm:w-auto">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {bill && <p className="mt-1 text-sm">Next bill: <strong>KES {bill.amount.toLocaleString()}</strong> {bill.label}.</p>}
      {error && <p className="mt-1 text-xs text-error-600">{error}</p>}
    </div>
  );
}
