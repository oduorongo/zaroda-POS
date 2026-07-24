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
  maxDevices: number;
  maxBranches: number;
}

const INDUSTRY_TYPES = ["RETAIL", "RESTAURANT", "PHARMACY", "SALON"];

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
  const [terminalCount, setTerminalCount] = useState("1");
  const [planTier, setPlanTier] = useState("");

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
        const result = await apiGet<Plan[]>("/platform-admin/plans");
        setPlans(result);
        if (result[0]) setPlanTier(result[0].tier);
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
        terminalCount: Number(terminalCount) || 1,
        planTier,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not onboard tenant.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    organizationName.trim() &&
    ownerFullName.trim() &&
    ownerEmail.trim() &&
    ownerPassword.length >= 8 &&
    branchName.trim() &&
    planTier;

  if (!session) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Nav session={session} />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-xl font-bold">Onboard a new tenant</h1>

        {done ? (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardContent className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-600 text-2xl">✓</div>
              <p className="mt-3 font-semibold text-zinc-100">Tenant onboarded</p>
              <p className="mt-1 text-sm text-zinc-400">The owner can now log in to the back office with the email and password you set.</p>
              <Button onClick={() => router.push("/organizations")} className="mt-6" variant="primary">
                Back to tenant list
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="border-zinc-800"><CardTitle className="text-zinc-100">Business details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-zinc-400">Business name</Label>
                  <Input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} className="border-zinc-700 bg-zinc-950" />
                </div>
                <div>
                  <Label className="text-zinc-400">Industry</Label>
                  <select value={industryType} onChange={(e) => setIndustryType(e.target.value)} className="w-full rounded-md border border-zinc-700 bg-zinc-950 p-2.5 text-sm">
                    {INDUSTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-zinc-400">KRA PIN (optional)</Label>
                  <Input value={kraPin} onChange={(e) => setKraPin(e.target.value)} className="border-zinc-700 bg-zinc-950" />
                </div>
                <div>
                  <Label className="text-zinc-400">First branch name</Label>
                  <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} className="border-zinc-700 bg-zinc-950" />
                </div>
                <div>
                  <Label className="text-zinc-400">Number of devices/terminals</Label>
                  <Input type="number" min={1} value={terminalCount} onChange={(e) => setTerminalCount(e.target.value)} className="w-24 border-zinc-700 bg-zinc-950" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="border-zinc-800"><CardTitle className="text-zinc-100">Owner account</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-zinc-400">Full name</Label>
                  <Input value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} className="border-zinc-700 bg-zinc-950" />
                </div>
                <div>
                  <Label className="text-zinc-400">Email</Label>
                  <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} className="border-zinc-700 bg-zinc-950" />
                </div>
                <div>
                  <Label className="text-zinc-400">Temporary password (min 8 characters)</Label>
                  <Input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} className="border-zinc-700 bg-zinc-950" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="border-zinc-800"><CardTitle className="text-zinc-100">Plan</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-3">
                  {plans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => setPlanTier(plan.tier)}
                      className={`rounded-lg border p-3 text-left ${planTier === plan.tier ? "border-amber-500 bg-amber-500/10" : "border-zinc-700 hover:border-zinc-600"}`}
                    >
                      <p className="font-semibold text-zinc-100">{plan.name}</p>
                      <p className="text-lg font-bold text-amber-400">KES {Number(plan.priceKes).toLocaleString()}<span className="text-xs font-normal text-zinc-500">/mo</span></p>
                      <p className="text-xs text-zinc-500">{plan.maxDevices} devices · {plan.maxBranches} branches</p>
                    </button>
                  ))}
                  {plans.length === 0 && <p className="text-sm text-zinc-500">No plans configured yet - run `pnpm --filter api seed:plans`.</p>}
                </div>
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
