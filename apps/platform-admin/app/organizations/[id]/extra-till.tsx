"use client";

import { useState } from "react";
import { apiPatch, ApiError } from "../../../lib/api";

/** Adds or removes the extra till a plan allows (Basic: one), billed at the business's till price. */
export function ExtraTill({
  organizationId,
  plan,
  extraTills,
  tillPriceKes,
  onChanged,
}: {
  organizationId: string;
  plan: { name: string; maxDevices: number; maxExtraTills: number };
  extraTills: number;
  tillPriceKes: number;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!plan.maxExtraTills) return null;
  const adding = extraTills < plan.maxExtraTills;

  async function change() {
    if (!adding && !window.confirm("Remove the extra till? The business must already be down to " + plan.maxDevices + " till" + (plan.maxDevices === 1 ? "" : "s") + ".")) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/platform-admin/organizations/${organizationId}/extra-tills`, { extraTills: adding ? extraTills + 1 : extraTills - 1 });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the tills.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-secondary-500">Extra till</p>
      <p className="text-sm">
        {extraTills > 0
          ? `${extraTills} extra till - ${plan.maxDevices + extraTills} tills in all, each KES ${tillPriceKes.toLocaleString()} a month.`
          : `None. The ${plan.name} plan can have ${plan.maxExtraTills} extra till at the business's own till price (KES ${tillPriceKes.toLocaleString()} a month).`}
      </p>
      <button
        onClick={() => void change()}
        disabled={busy}
        className="mt-2 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-40"
      >
        {busy ? "..." : adding ? `Add an extra till (+KES ${tillPriceKes.toLocaleString()} a month)` : "Remove the extra till"}
      </button>
      <p className="mt-1 text-xs text-secondary-500">The next payment is at the new monthly total.</p>
      {error && <p className="mt-1 text-xs text-error-600">{error}</p>}
    </div>
  );
}
