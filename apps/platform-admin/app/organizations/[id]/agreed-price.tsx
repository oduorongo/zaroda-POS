"use client";

import { useState } from "react";
import { apiPatch, ApiError } from "../../../lib/api";

const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/**
 * The monthly price agreed with this business, inside its plan's range (Basic: 1,000 - 2,500 per till).
 * A team member sets it when they onboard a business; for self-registered businesses the system admin sets it here.
 */
export function AgreedPrice({
  organizationId,
  plan,
  monthlyPriceKes,
  onboardedByTeam,
  onChanged,
}: {
  organizationId: string;
  plan: { name: string; priceKes: string; minPriceKes: string | null };
  monthlyPriceKes: number;
  onboardedByTeam: boolean;
  onChanged: () => Promise<void>;
}) {
  const max = Number(plan.priceKes);
  const min = plan.minPriceKes != null ? Number(plan.minPriceKes) : max;
  const [price, setPrice] = useState(String(monthlyPriceKes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (min === max) return null;
  const value = Number(price);
  const ok = Number.isInteger(value) && value >= min && value <= max && value !== monthlyPriceKes;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/platform-admin/organizations/${organizationId}/price`, { monthlyPriceKes: value });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the price.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-secondary-500">Monthly price</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          step={50}
          min={min}
          max={max}
          aria-label="Monthly price in KES"
          className="w-32 rounded-md border border-border bg-background p-1.5"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <button
          onClick={() => void save()}
          disabled={busy || !ok}
          className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-40"
        >
          {busy ? "..." : "Save price"}
        </button>
      </div>
      <p className="mt-1 text-xs text-secondary-500">
        The {plan.name} plan is {kes(min)} - {kes(max)} a month per till. {onboardedByTeam
          ? "The team member who signed this business up chose its price; change it only if ZARODA agrees a new one."
          : "This business signed itself up, so it pays the full price until you set the price agreed with it."}{" "}
        The next payment is at the new price.
      </p>
      {error && <p className="mt-1 text-xs text-error-600">{error}</p>}
    </div>
  );
}
