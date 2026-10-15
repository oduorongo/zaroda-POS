"use client";

import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, LoadingState } from "@zaroda/ui";
import { ApiError } from "../../../lib/api";
import { TeamShell } from "../../../components/team-shell";
import { teamGet, teamPost, type TeamMe, type TeamShop } from "../../../lib/team-api";

const STATUS: Record<NonNullable<TeamShop["subscription"]>["status"], { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
  TRIAL: { label: "On free trial", variant: "warning" },
  ACTIVE: { label: "Paying", variant: "success" },
  GRACE: { label: "Payment overdue", variant: "warning" },
  SUSPENDED: { label: "Suspended", variant: "error" },
};
const INDUSTRIES = [
  ["RETAIL", "Retail shop"],
  ["RESTAURANT", "Restaurant"],
  ["PHARMACY", "Pharmacy"],
  ["SALON", "Salon"],
  ["RENTAL", "Rental landlord"],
] as const;

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
  }, []);

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
              <input type="password" minLength={8} autoComplete="new-password" className={inputClass} value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} />
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
          </div>
          <p className="text-xs text-secondary-500">
            The shop is credited to you for good once it is signed up. It starts on a 14-day free trial; your bonus comes after it pays its first monthly subscription.
          </p>
          {formError && <p className="text-sm text-error-600">{formError}</p>}
          <Button type="submit" disabled={busy || !organizationName.trim() || !ownerFullName.trim() || !ownerEmail.trim()}>
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
