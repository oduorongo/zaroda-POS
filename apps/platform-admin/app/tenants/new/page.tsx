"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@zaroda/ui";

interface Plan {
  id: string;
  tier: string;
  name: string;
  priceKes: string;
  minPriceKes?: string | null;
  maxExtraTills?: number;
  billingCycle?: string;
  annualPriceKes?: string | null;
  instalmentCount?: number | null;
  instalmentKes?: string | null;
  extraTillKes?: string;
  extraTillAnnualKes?: string;
  active?: boolean;
  maxDevices: number;
  maxBranches: number;
}

const INDUSTRY_TYPES = ["RETAIL", "RESTAURANT", "SALON", "RENTAL", "SCHOOL_SUPPLIER", "UNIFORM_MAKER", "HOTEL"];

/**
 * Admin-driven onboarding wizard - creates the tenant, owner account,
 * first branch/terminals, and an ACTIVE (not trial) subscription in one
 * step. See PlatformAdminService.onboardTenant for why this differs from
 * the public self-service /auth/register flow.
 */
export default function NewTenantPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  const [organizationName, setOrganizationName] = useState("");
  const [industryType, setIndustryType] = useState("RETAIL");
  const [kraPin, setKraPin] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [branchName, setBranchName] = useState("");
  const [county, setCounty] = useState("");
  const [subCounty, setSubCounty] = useState("");
  const [terminalCount, setTerminalCount] = useState("1");
  const [planTier, setPlanTier] = useState("");
  const [price, setPrice] = useState("");
  const [billing, setBilling] = useState<"MONTHLY" | "ANNUAL" | "INSTALMENTS">("MONTHLY");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void (async () => {
      try {
        const result = (await apiGet<Plan[]>("/platform-admin/plans")).filter((p) => p.active !== false);
        setPlans(result);
        const first = result.find((p) => p.billingCycle !== "SEASONAL") ?? result[0];
        if (first) setPlanTier(first.tier);
      } catch {
        // Plan dropdown just stays empty - submit is disabled without a
        // selected tier, so this fails safe rather than silently.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/platform-admin/tenants", {
        organizationName: organizationName.trim(),
        industryType,
        kraPin: kraPin.trim() || undefined,
        ownerFullName: ownerFullName.trim(),
        ownerEmail: ownerEmail.trim(),
        ownerPassword,
        branchName: branchName.trim(),
        county: county.trim() || undefined,
        subCounty: subCounty.trim() || undefined,
        terminalCount: Number(terminalCount) || 1,
        planTier,
        ...(ranged && billing === "MONTHLY" && price.trim() ? { monthlyPriceKes: Number(price) } : {}),
        ...(choosesBilling ? { billingChoice: billing } : {}),
        ...(chosen && (chosen.maxExtraTills ?? 0) > 0 ? { extraTills: Math.max(0, (Number(terminalCount) || 1) - chosen.maxDevices) } : {}),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not onboard tenant.");
    } finally {
      setSubmitting(false);
    }
  }

  const chosen = plans.find((p) => p.tier === planTier);
  const ranged = !!chosen && chosen.billingCycle !== "SEASONAL" && chosen.minPriceKes != null && Number(chosen.minPriceKes) < Number(chosen.priceKes);
  const priceOk = !ranged || price.trim() === "" || (Number.isInteger(Number(price)) && Number(price) >= Number(chosen!.minPriceKes) && Number(price) <= Number(chosen!.priceKes));

  // Monthly, yearly or yearly in instalments, for paid shop plans (school suppliers pay by term).
  const choosesBilling = !!chosen && chosen.billingCycle !== "SEASONAL" && Number(chosen.priceKes) > 0;
  const extras = chosen ? Math.max(0, (Number(terminalCount) || 1) - chosen.maxDevices) : 0;
  const annualOf = (p: Plan) => Number(p.annualPriceKes ?? Number(p.priceKes) * 12);
  const firstBill = !choosesBilling
    ? null
    : billing === "ANNUAL"
      ? { amount: annualOf(chosen!) + extras * Number(chosen!.extraTillAnnualKes ?? 5000), label: "for the year" }
      : billing === "INSTALMENTS" && chosen!.instalmentCount
        ? { amount: Math.round(Number(chosen!.instalmentKes) + (extras * Number(chosen!.extraTillAnnualKes ?? 5000)) / chosen!.instalmentCount), label: `each of ${chosen!.instalmentCount} instalments` }
        : { amount: (price.trim() && ranged ? Number(price) : Number(chosen!.priceKes)) + extras * Number(chosen!.extraTillKes ?? 500), label: "a month" };

  const canSubmit =
    priceOk &&
    organizationName.trim() &&
    ownerFullName.trim() &&
    ownerEmail.trim() &&
    ownerPassword.length >= 8 &&
    branchName.trim() &&
    planTier;

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-xl font-bold">Onboard a new tenant</h1>

        {done ? (
          <Card className="border-border bg-surface">
            <CardContent className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-600 text-2xl">✓</div>
              <p className="mt-3 font-semibold text-foreground">Tenant onboarded</p>
              <p className="mt-1 text-sm text-secondary-500">The owner can now log in to the back office with the email and password you set.</p>
              <Button onClick={() => router.push("/organizations")} className="mt-6" variant="primary">
                Back to tenant list
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="border-border bg-surface">
              <CardHeader className="border-border"><CardTitle className="text-foreground">Business details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-secondary-500">Business name</Label>
                  <Input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} className="border-border bg-background" />
                </div>
                <div>
                  <Label className="text-secondary-500">Industry</Label>
                  <select value={industryType} onChange={(e) => {
                    setIndustryType(e.target.value);
                    // School suppliers start on the seasonal (per term) plan; the admin can still pick another.
                    const seasonal = plans.find((p) => p.billingCycle === "SEASONAL" && p.active !== false);
                    if ((e.target.value === "SCHOOL_SUPPLIER" || e.target.value === "UNIFORM_MAKER") && seasonal) setPlanTier(seasonal.tier);
                    else if (seasonal && planTier === seasonal.tier && plans[0]) setPlanTier(plans.find((p) => p.billingCycle !== "SEASONAL")?.tier ?? plans[0].tier);
                  }} className="w-full rounded-md border border-border bg-background p-2.5 text-sm">
                    {INDUSTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-secondary-500">KRA PIN (optional)</Label>
                  <Input value={kraPin} onChange={(e) => setKraPin(e.target.value)} className="border-border bg-background" />
                </div>
                <div>
                  <Label className="text-secondary-500">First branch name</Label>
                  <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} className="border-border bg-background" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-secondary-500">County</Label>
                    <Input value={county} onChange={(e) => setCounty(e.target.value)} placeholder="e.g. Nairobi" className="border-border bg-background" />
                  </div>
                  <div>
                    <Label className="text-secondary-500">Sub-county</Label>
                    <Input value={subCounty} onChange={(e) => setSubCounty(e.target.value)} placeholder="e.g. Westlands" className="border-border bg-background" />
                  </div>
                </div>
                <div>
                  <Label className="text-secondary-500">Number of devices/terminals</Label>
                  <Input type="number" min={1} value={terminalCount} onChange={(e) => setTerminalCount(e.target.value)} className="w-24 border-border bg-background" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-surface">
              <CardHeader className="border-border"><CardTitle className="text-foreground">Owner account</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-secondary-500">Full name</Label>
                  <Input value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} className="border-border bg-background" />
                </div>
                <div>
                  <Label className="text-secondary-500">Email</Label>
                  <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} className="border-border bg-background" />
                </div>
                <div>
                  <Label className="text-secondary-500">Temporary password (min 8 characters)</Label>
                  <Input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} className="border-border bg-background" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-surface">
              <CardHeader className="border-border"><CardTitle className="text-foreground">Plan</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-3">
                  {plans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => { setPlanTier(plan.tier); if (billing === "INSTALMENTS" && !plan.instalmentCount) setBilling("MONTHLY"); }}
                      className={`rounded-lg border p-3 text-left ${planTier === plan.tier ? "border-amber-500 bg-amber-500/10" : "border-border hover:border-primary-500"}`}
                    >
                      <p className="font-semibold text-foreground">{plan.name}</p>
                      <p className="text-lg font-bold text-amber-400">KES {Number(plan.priceKes).toLocaleString()}<span className="text-xs font-normal text-secondary-500">{plan.billingCycle === "SEASONAL" ? "/year" : "/mo"}</span></p>
                      {plan.billingCycle === "SEASONAL" ? (
                        plan.instalmentCount ? <p className="text-xs text-secondary-500">or {plan.instalmentCount} termly × KES {Number(plan.instalmentKes).toLocaleString()}</p> : null
                      ) : Number(plan.priceKes) > 0 ? (
                        <p className="text-xs text-secondary-500">
                          KES {annualOf(plan).toLocaleString()}/year{plan.instalmentCount ? ` or ${plan.instalmentCount} × ${Number(plan.instalmentKes).toLocaleString()}` : ""}
                        </p>
                      ) : null}
                      <p className="text-xs text-secondary-500">{plan.maxDevices} devices · {plan.maxBranches} branches</p>
                    </button>
                  ))}
                  {plans.length === 0 && <p className="text-sm text-secondary-500">No plans configured yet - run `pnpm --filter api seed:plans`.</p>}
                </div>
                {chosen && (chosen.maxExtraTills ?? 0) > 0 && (
                  <p className="mt-2 text-xs text-secondary-500">
                    The {chosen.name} plan includes {chosen.maxDevices} till{chosen.maxDevices === 1 ? "" : "s"}; up to {chosen.maxExtraTills} more can be added at KES{" "}
                    {Number(chosen.extraTillKes ?? 500).toLocaleString()} a month or {Number(chosen.extraTillAnnualKes ?? 5000).toLocaleString()} a year each - raise the
                    number of devices above to add them.
                  </p>
                )}
                {choosesBilling && (
                  <div className="mt-3">
                    <label className="mb-1.5 block text-sm text-secondary-500">How the business pays</label>
                    <select value={billing} onChange={(e) => setBilling(e.target.value as typeof billing)} className="rounded-md border border-border bg-background p-2 text-sm">
                      <option value="MONTHLY">Monthly - KES {Number(chosen!.priceKes).toLocaleString()} a month</option>
                      <option value="ANNUAL">Yearly - KES {annualOf(chosen!).toLocaleString()} (2 months free)</option>
                      {chosen!.instalmentCount ? (
                        <option value="INSTALMENTS">Yearly in {chosen!.instalmentCount} instalments - {chosen!.instalmentCount} × KES {Number(chosen!.instalmentKes).toLocaleString()}</option>
                      ) : null}
                    </select>
                    {firstBill && (
                      <p className="mt-1 text-xs text-secondary-500">
                        Bill: KES {firstBill.amount.toLocaleString()} {firstBill.label}{extras > 0 ? ` (with ${extras} extra till${extras === 1 ? "" : "s"})` : ""}. The business starts paid up for one bill.
                      </p>
                    )}
                  </div>
                )}
                {ranged && billing === "MONTHLY" && (
                  <div className="mt-3">
                    <label className="mb-1.5 block text-sm text-secondary-500">
                      Monthly price agreed with the business (KES {Number(chosen!.minPriceKes).toLocaleString()} - {Number(chosen!.priceKes).toLocaleString()} per till)
                    </label>
                    <Input
                      type="number"
                      step={50}
                      min={Number(chosen!.minPriceKes)}
                      max={Number(chosen!.priceKes)}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder={`Leave empty for the full ${Number(chosen!.priceKes).toLocaleString()}`}
                      className="w-56 border-border bg-background"
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {error && <p className="text-sm text-error-500">{error}</p>}

            <button
              onClick={() => void submit()}
              disabled={submitting || !canSubmit}
              className="w-full rounded-md bg-amber-500 py-3 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
            >
              {submitting ? "Onboarding..." : "Onboard tenant"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
