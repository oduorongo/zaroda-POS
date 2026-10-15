"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../../lib/api";

type PlanCode = "bure" | "starter" | "collect";

interface PlanDef {
  code: PlanCode;
  name: string;
  unitLimit: number | null;
  monthlyPrice: number;
  annualPrice: number | null;
  feePercent: number;
  features: string[];
}

interface PlanView {
  plan: PlanCode;
  name: string;
  unitLimit: number | null;
  occupiedUnits: number;
  billingCycle: "monthly" | "annual";
  pendingPlan: PlanCode | null;
  pendingPlanFrom: string | null;
  freeUntil: string | null;
  gatewayReady: boolean;
  plans: PlanDef[];
}

const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const secondaryButton = "rounded-md border border-border px-3 py-2 text-sm hover:bg-background disabled:opacity-50";

const money = (n: number) => n.toLocaleString("en-KE");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" });

const DESCRIPTION: Record<PlanCode, string[]> = {
  bure: ["Tenant records and monthly rent invoices", "Record payments by hand", "Arrears list"],
  starter: ["Everything in Bure", "Tenant portal and printable receipts", "Rent reminders and monthly statements"],
  collect: ["Everything in Starter", "Tenants pay by M-Pesa and rent is matched automatically", "Through your own Paybill, Till or Tuma account"],
};

function priceLine(plan: PlanDef, cycle: "monthly" | "annual"): string {
  if (plan.feePercent > 0) return `${plan.feePercent}% of rent collected through your gateway`;
  if (plan.monthlyPrice === 0) return "Free";
  return cycle === "annual" && plan.annualPrice !== null ? `KES ${money(plan.annualPrice)} a year (2 months free)` : `KES ${money(plan.monthlyPrice)} a month`;
}

/** The landlord's ZARODA plan: what they are on, how many units it covers, and moving to another plan. */
export function PlanSection({ onChanged }: { onChanged: () => void }) {
  const [view, setView] = useState<PlanView | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    apiGet<PlanView>("/rental/plan")
      .then((v) => {
        setView(v);
        setCycle(v.billingCycle);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your plan."));

  useEffect(() => {
    void load();
  }, []);

  async function choose(plan: PlanCode) {
    setBusy(true);
    setError(null);
    try {
      setView(await apiPost<PlanView>("/rental/plan", { plan, billingCycle: cycle }));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) return error ? <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p> : <p className="text-sm text-secondary-500">Loading your plan...</p>;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs text-secondary-500">Your plan</p>
        <p className="text-xl font-bold">{view.name}</p>
        <p className="text-sm text-secondary-500">
          {view.occupiedUnits} occupied {view.occupiedUnits === 1 ? "unit" : "units"}
          {view.unitLimit !== null ? ` of ${view.unitLimit} allowed` : " (no limit)"}
        </p>
        {view.freeUntil && <p className="mt-2 text-sm text-green-400">No charge until {day(view.freeUntil)}. Choose the plan you want before then.</p>}
        {view.pendingPlan && view.pendingPlanFrom && (
          <p className="mt-2 text-sm text-amber-400">
            Moving to {view.plans.find((p) => p.code === view.pendingPlan)?.name} on {day(view.pendingPlanFrom)}.{" "}
            <button className="underline" disabled={busy} onClick={() => void choose(view.plan)}>
              Cancel the move
            </button>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-secondary-500">Starter billed:</span>
        {(["monthly", "annual"] as const).map((c) => (
          <button key={c} onClick={() => setCycle(c)} className={`rounded-md px-3 py-1 capitalize ${cycle === c ? "bg-primary-600 text-white" : "border border-border bg-surface"}`}>
            {c}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {view.plans.map((p) => {
          const current = p.code === view.plan;
          const tooSmall = p.unitLimit !== null && view.occupiedUnits > p.unitLimit;
          const needsGateway = p.code === "collect" && !view.gatewayReady;
          return (
            <div key={p.code} className={`flex flex-col rounded-lg border p-4 ${current ? "border-primary-600 bg-surface" : "border-border bg-surface"}`}>
              <p className="text-lg font-semibold">{p.name}</p>
              <p className="text-sm text-secondary-500">{p.unitLimit === null ? "Any number of units" : p.code === "bure" ? "1 to 5 occupied units" : `6 to ${p.unitLimit} occupied units`}</p>
              <p className="mt-2 font-medium">{priceLine(p, cycle)}</p>
              <ul className="mt-2 flex-1 list-disc space-y-1 pl-5 text-sm text-secondary-500">
                {DESCRIPTION[p.code].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {needsGateway && <p className="mt-2 text-xs text-amber-400">Connect Tuma or your own Paybill/Till first (Rent tab, M-Pesa settings).</p>}
              {tooSmall && <p className="mt-2 text-xs text-amber-400">You have more occupied units than this plan covers.</p>}
              <div className="mt-3">
                {current && !view.pendingPlan ? (
                  p.annualPrice !== null && cycle !== view.billingCycle ? (
                    <button className={button} disabled={busy} onClick={() => void choose(p.code)}>Switch to {cycle}</button>
                  ) : (
                    <span className="text-sm text-green-400">Your current plan</span>
                  )
                ) : (
                  <button className={current ? secondaryButton : button} disabled={busy || tooSmall || needsGateway} onClick={() => void choose(p.code)}>
                    {current ? "Stay on this plan" : `Choose ${p.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-secondary-500">
        Moving up to a bigger plan starts at once. Moving to a smaller plan starts on the 1st of next month. Plans are billed on occupied units, meaning units with an active lease. ZARODA never holds your tenants&apos; rent: it goes straight to your own account.
      </p>
    </div>
  );
}
