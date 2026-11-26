"use client";

import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, LoadingState, PasswordInput } from "@zaroda/ui";
import { ApiError } from "../../../lib/api";
import { TeamShell } from "../../../components/team-shell";
import { teamGet, teamPlans, teamPost, type TeamMe, type TeamPlan, type TeamShop } from "../../../lib/team-api";

const STATUS: Record<NonNullable<TeamShop["subscription"]>["status"], { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
  TRIAL: { label: "On free trial", variant: "warning" },
  ACTIVE: { label: "Paying", variant: "success" },
  GRACE: { label: "Payment overdue", variant: "warning" },
  SUSPENDED: { label: "Suspended", variant: "error" },
};
const INDUSTRIES = [
  ["RETAIL", "Retail shop"],
  ["RESTAURANT", "Restaurant"],
  ["SALON", "Salon"],
  ["RENTAL", "Rental landlord"],
  ["SCHOOL_SUPPLIER", "School supplier"],
  ["UNIFORM_MAKER", "School uniforms"],
  ["HOTEL", "Hotel / lodge"],
] as const;

/** Rental landlords have no tills, so no monthly device price. */
const NO_DEVICE_PLAN = new Set(["RENTAL"]);
/** School suppliers and uniform makers go on the School Supplier plan (yearly, in termly instalments). */
const SCHOOL_TYPES = new Set(["SCHOOL_SUPPLIER", "UNIFORM_MAKER"]);
type Billing = "MONTHLY" | "ANNUAL" | "INSTALMENTS";
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

const inputClass = "mt-1 w-full rounded-md border border-border bg-background p-2";

function ShopsBody({ me }: { me: TeamMe }) {
  const [shops, setShops] = useState<TeamShop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [organizationName, setOrganizationName] = useState("");
  const [industryType, setIndustryType] = useState("RETAIL");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [branchName, setBranchName] = useState("");
  const [county, setCounty] = useState("");
  const [subCounty, setSubCounty] = useState("");
  const [plans, setPlans] = useState<TeamPlan[]>([]);
  const [planTier, setPlanTier] = useState("BASIC");
  const [billing, setBilling] = useState<Billing>("MONTHLY");
  const [price, setPrice] = useState("");
  const [extraTills, setExtraTills] = useState(0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; password: string | null } | null>(null);

  async function load() {
    try {
      setShops(await teamGet<TeamShop[]>("/tenants"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load shops.");
    }
  }

  useEffect(() => {
    void load();
    teamPlans().then(setPlans, () => setPlans([]));
  }, []);

  const school = SCHOOL_TYPES.has(industryType);
  const picksPlan = !NO_DEVICE_PLAN.has(industryType) && !school;
  const shopPlans = plans.filter((p) => ["BASIC", "STANDARD", "BUSINESS"].includes(p.tier));
  const plan = shopPlans.find((p) => p.tier === planTier);
  const seasonal = plans.find((p) => p.billingCycle === "SEASONAL");
  const ranged = picksPlan && !!plan && plan.minPriceKes != null && Number(plan.minPriceKes) < Number(plan.priceKes);
  const priceNum = Number(price);
  const priceOk = !ranged || billing !== "MONTHLY" || (price !== "" && Number.isInteger(priceNum) && priceNum >= Number(plan!.minPriceKes) && priceNum <= Number(plan!.priceKes));
  const annualOf = (p: TeamPlan) => Number(p.annualPriceKes ?? Number(p.priceKes) * 12);
  const bill =
    !picksPlan || !plan
      ? null
      : billing === "ANNUAL"
        ? `${kes(annualOf(plan) + extraTills * Number(plan.extraTillAnnualKes))} a year`
        : billing === "INSTALMENTS" && plan.instalmentCount
          ? `${plan.instalmentCount} × ${kes(Math.round(Number(plan.instalmentKes) + (extraTills * Number(plan.extraTillAnnualKes)) / plan.instalmentCount))}`
          : `${kes((ranged && price ? priceNum : Number(plan.priceKes)) + extraTills * Number(plan.extraTillKes))} a month`;

  async function onboard(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const result = await teamPost<{ ownerEmail: string; temporaryPassword?: string }>("/tenants", {
        organizationName: organizationName.trim(),
        industryType,
        ownerFullName: ownerFullName.trim(),
        ownerEmail: ownerEmail.trim(),
        ...(ownerPassword ? { ownerPassword } : {}),
        branchName: branchName.trim() || organizationName.trim(),
        ...(county.trim() ? { county: county.trim() } : {}),
        ...(subCounty.trim() ? { subCounty: subCounty.trim() } : {}),
        ...(picksPlan ? { planTier, billingChoice: billing } : {}),
        ...(ranged && billing === "MONTHLY" ? { monthlyPriceKes: priceNum } : {}),
        ...(picksPlan && extraTills > 0 ? { extraTills } : {}),
      });
      setCreated({ name: organizationName.trim(), email: result.ownerEmail, password: result.temporaryPassword ?? null });
      setShowForm(false);
      setOrganizationName("");
      setOwnerFullName("");
      setOwnerEmail("");
      setOwnerPassword("");
      setBranchName("");
      setCounty("");
      setSubCounty("");
      setPrice("");
      setExtraTills(0);
      setBilling("MONTHLY");
      setPlanTier("BASIC");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not sign the shop up.");
    } finally {
      setBusy(false);
    }
  }

  const isLeader = me.agent.role === "LEADER";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{isLeader ? "Your team's shops" : "Your shops"}</h1>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Sign up a shop"}</Button>
      </div>

      {created && (
        <div className="rounded-lg border border-success-600/40 bg-success-50 p-4 text-sm">
          <p className="font-semibold">{created.name} is signed up on a 14-day free trial.</p>
          <p className="mt-1">
            The owner signs in at the back office with <b>{created.email}</b>
            {created.password ? (
              <>
                {" "}
                and the temporary password <b className="font-mono text-base">{created.password}</b>. It is shown once - pass it on now, and ask them to change it.
              </>
            ) : (
              <> and the password you set for them.</>
            )}
          </p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setCreated(null)}>
            I have passed it on
          </Button>
        </div>
      )}

      {showForm && (
        <form onSubmit={onboard} className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Shop name
              <input required className={inputClass} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} />
            </label>
            <label className="text-sm">
              Type of business
              <select className={inputClass} value={industryType} onChange={(e) => setIndustryType(e.target.value)}>
                {INDUSTRIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Owner&apos;s full name
              <input required className={inputClass} value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} />
            </label>
            <label className="text-sm">
              Owner&apos;s email (their sign-in)
              <input required type="email" className={inputClass} value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
            </label>
            <label className="text-sm">
              Password for the owner (leave empty to make one)
              <PasswordInput minLength={8} autoComplete="new-password" className={inputClass} value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} />
            </label>
            <label className="text-sm">
              First branch name (defaults to the shop name)
              <input className={inputClass} value={branchName} onChange={(e) => setBranchName(e.target.value)} />
            </label>
            <label className="text-sm">
              County
              <input className={inputClass} value={county} onChange={(e) => setCounty(e.target.value)} />
            </label>
            <label className="text-sm">
              Sub-county / town
              <input className={inputClass} value={subCounty} onChange={(e) => setSubCounty(e.target.value)} />
            </label>
            {school && seasonal && (
              <p className="text-sm sm:col-span-2">
                {seasonal.name} plan: {kes(Number(seasonal.annualPriceKes ?? seasonal.priceKes))} a year
                {seasonal.instalmentCount ? `, or ${seasonal.instalmentCount} termly instalments of ${kes(Number(seasonal.instalmentKes))}` : ""}.
              </p>
            )}
            {picksPlan && (
              <label className="text-sm">
                Plan
                <select
                  className={inputClass}
                  value={planTier}
                  onChange={(e) => {
                    const next = shopPlans.find((p) => p.tier === e.target.value);
                    setPlanTier(e.target.value);
                    setExtraTills(0);
                    if (billing === "INSTALMENTS" && !next?.instalmentCount) setBilling("MONTHLY");
                  }}
                >
                  {shopPlans.map((p) => (
                    <option key={p.tier} value={p.tier}>
                      {p.name} - {kes(Number(p.priceKes))}/mo ({p.maxDevices} till{p.maxDevices === 1 ? "" : "s"}, {p.maxBranches} branch{p.maxBranches === 1 ? "" : "es"})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {picksPlan && plan && (
              <label className="text-sm">
                How the shop pays after the trial
                <select className={inputClass} value={billing} onChange={(e) => setBilling(e.target.value as Billing)}>
                  <option value="MONTHLY">Monthly - {kes(Number(plan.priceKes))} a month</option>
                  <option value="ANNUAL">Yearly - {kes(annualOf(plan))} (2 months free)</option>
                  {plan.instalmentCount ? <option value="INSTALMENTS">Yearly in {plan.instalmentCount} instalments of {kes(Number(plan.instalmentKes))}</option> : null}
                </select>
              </label>
            )}
            {ranged && billing === "MONTHLY" && (
              <label className="text-sm">
                Monthly price agreed with the owner (KES per till)
                <input
                  required
                  type="number"
                  inputMode="numeric"
                  step={50}
                  min={Number(plan!.minPriceKes)}
                  max={Number(plan!.priceKes)}
                  placeholder={`${Number(plan!.minPriceKes)} - ${Number(plan!.priceKes)}`}
                  className={inputClass}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
            )}
            {picksPlan && plan && plan.maxExtraTills > 0 && (
              <label className="text-sm">
                Extra tills ({kes(Number(plan.extraTillKes))} a month or {kes(Number(plan.extraTillAnnualKes))} a year each)
                <input
                  type="number"
                  min={0}
                  max={plan.maxExtraTills}
                  className={inputClass}
                  value={extraTills}
                  onChange={(e) => setExtraTills(Math.max(0, Math.min(plan.maxExtraTills, Math.floor(Number(e.target.value) || 0))))}
                />
              </label>
            )}
            {bill && (
              <p className="text-sm sm:col-span-2">
                After the free trial the shop pays <strong>{bill}</strong>.
              </p>
            )}
          </div>
          <p className="text-xs text-secondary-500">
            The shop is credited to you for good once it is signed up. It starts on a 14-day free trial. You earn a share of each plan payment it makes in your earning period, and the sign-up bonus on its second payment (or its first, if it pays yearly or by instalments).
          </p>
          {formError && <p className="text-sm text-error-600">{formError}</p>}
          <Button type="submit" disabled={busy || !organizationName.trim() || !ownerFullName.trim() || !ownerEmail.trim() || !priceOk}>
            {busy ? "Signing up..." : "Sign up this shop"}
          </Button>
        </form>
      )}

      {!shops && !error && <LoadingState label="Loading shops..." />}
      {error && <p className="text-sm text-error-600">{error}</p>}
      {shops && shops.length === 0 && <EmptyState title="No shops yet" description="Sign up your first shop and it will appear here." />}

      <ul className="space-y-3">
        {shops?.map((s) => (
          <li key={s.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.name}</span>
                  {s.subscription && <Badge variant={STATUS[s.subscription.status].variant}>{STATUS[s.subscription.status].label}</Badge>}
                  {!s.isActive && <Badge variant="error">Deactivated</Badge>}
                  {s.onlineShop.isPublished && <Badge variant="success">Selling online</Badge>}
                  {s.onlineShop.addonActive && !s.onlineShop.isPublished && <Badge variant="neutral">Online shop not live</Badge>}
                </div>
                <p className="text-sm text-secondary-500">
                  {[s.county, s.subCounty].filter(Boolean).join(", ") || "Location not set"} · signed up {new Date(s.createdAt).toLocaleDateString("en-KE")}
                  {isLeader && s.onboardedBy ? ` · by ${s.onboardedBy.fullName}` : ""}
                </p>
              </div>
              <div className="text-right text-sm text-secondary-500">
                <p>{s.saleCount} sale{s.saleCount === 1 ? "" : "s"} so far</p>
                <p>{s.lastSaleAt ? `Last sale ${new Date(s.lastSaleAt).toLocaleDateString("en-KE")}` : "No sales yet"}</p>
                {s.subscription && (
                  <p>
                    {s.subscription.isTrial ? "Trial ends" : "Paid until"} {new Date(s.subscription.currentPeriodEnd).toLocaleDateString("en-KE")}
                  </p>
                )}
                {s.subscription && (
                  <p>
                    {s.subscription.planName}
                    {s.subscription.extraTills > 0 ? ` + ${s.subscription.extraTills} extra till${s.subscription.extraTills === 1 ? "" : "s"}` : ""} · {kes(s.subscription.monthlyPriceKes)} a month
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function TeamShopsPage() {
  return <TeamShell active="shops">{(me) => <ShopsBody me={me} />}</TeamShell>;
}
