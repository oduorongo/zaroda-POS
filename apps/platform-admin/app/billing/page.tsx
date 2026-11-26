"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, LoadingState, Modal, ModalFooter } from "@zaroda/ui";

interface Plan {
  id: string;
  tier: string;
  name: string;
  priceKes: string;
  minPriceKes: string | null;
  maxExtraTills: number;
  billingPeriodDays: number;
  billingCycle?: string;
  annualPriceKes?: string | null;
  instalmentCount?: number | null;
  instalmentKes?: string | null;
  extraTillKes?: string;
  extraTillAnnualKes?: string;
  maxDevices: number;
  maxBranches: number;
  active: boolean;
}

interface Organization {
  id: string;
  name: string;
  subscription: {
    planTier: string;
    planName: string;
    monthlyPriceKes: number;
    billingChoice?: string;
    bill?: { amount: number; label: string };
    currentPeriodEnd: string;
    status: "TRIAL" | "ACTIVE" | "GRACE" | "SUSPENDED";
  } | null;
}

const STATUS_VARIANT: Record<string, "primary" | "success" | "warning" | "error" | "neutral"> = {
  TRIAL: "primary",
  ACTIVE: "success",
  GRACE: "warning",
  SUSPENDED: "error",
};

/**
 * Plan pricing, overdue accounts (GRACE/SUSPENDED), and recording a
 * payment. Auto-suspend isn't a scheduled job here - subscription status
 * (ACTIVE/GRACE/SUSPENDED) is computed at read time from currentPeriodEnd +
 * graceDays (see subscriptions.util.ts), so "overdue" is always accurate
 * whenever this page loads without needing a cron to keep a stored status
 * column truthful.
 */
export default function BillingPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editMin, setEditMin] = useState("");
  const [editExtra, setEditExtra] = useState("0");
  const [editAnnual, setEditAnnual] = useState("");
  const [editCount, setEditCount] = useState("");
  const [editEach, setEditEach] = useState("");
  const [editTill, setEditTill] = useState("500");
  const [editTillYear, setEditTillYear] = useState("5000");
  const [planError, setPlanError] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  const [payingOrg, setPayingOrg] = useState<Organization | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("MPESA");
  const [payReference, setPayReference] = useState("");
  const [recording, setRecording] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [plansResult, orgsResult] = await Promise.all([
        apiGet<Plan[]>("/platform-admin/plans"),
        apiGet<Organization[]>("/platform-admin/organizations"),
      ]);
      setPlans(plansResult);
      setOrganizations(orgsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load billing data.");
    } finally {
      setLoading(false);
    }
  }

  async function savePlanPrice() {
    if (!editingPlan) return;
    const price = Number(editPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    const min = editMin.trim() === "" ? null : Number(editMin);
    if (min !== null && (!Number.isFinite(min) || min <= 0 || min > price)) {
      setPlanError("The lowest price must be above 0 and not above the full price");
      return;
    }
    setSavingPlan(true);
    setPlanError(null);
    try {
      // A seasonal plan's price is its annual price (billed in term instalments).
      const count = editCount.trim() === "" ? null : Math.floor(Number(editCount));
      const each = editEach.trim() === "" ? null : Number(editEach);
      if (editingPlan.billingCycle !== "SEASONAL" && ((count == null) !== (each == null) || (count != null && (count < 2 || !(each! > 0))))) {
        setPlanError("Give both the number of instalments (2 or more) and each instalment, or leave both empty");
        setSavingPlan(false);
        return;
      }
      const annual = editAnnual.trim() === "" ? null : Number(editAnnual);
      await apiPatch(
        `/platform-admin/plans/${editingPlan.id}`,
        editingPlan.billingCycle === "SEASONAL"
          ? { priceKes: price, annualPriceKes: price }
          : {
              priceKes: price,
              minPriceKes: min,
              maxExtraTills: Math.max(0, Math.floor(Number(editExtra) || 0)),
              ...(annual && annual > 0 ? { annualPriceKes: annual } : {}),
              instalmentCount: count,
              instalmentKes: each,
              extraTillKes: Math.max(0, Number(editTill) || 0),
              extraTillAnnualKes: Math.max(0, Number(editTillYear) || 0),
            },
      );
      setEditingPlan(null);
      await load();
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : "Could not save the price.");
    } finally {
      setSavingPlan(false);
    }
  }

  async function recordPayment() {
    if (!payingOrg) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setRecording(true);
    setPayError(null);
    try {
      await apiPost(`/platform-admin/organizations/${payingOrg.id}/payments`, {
        amount,
        method: payMethod,
        reference: payReference.trim() || undefined,
      });
      setPayingOrg(null);
      setPayAmount("");
      setPayReference("");
      await load();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : "Could not record payment.");
    } finally {
      setRecording(false);
    }
  }

  const overdue = organizations.filter((o) => o.subscription && (o.subscription.status === "GRACE" || o.subscription.status === "SUSPENDED"));

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-xl font-bold">Billing</h1>

        {loading && <LoadingState label="Loading billing data..." />}
        {!loading && error && <p className="text-sm text-error-500">{error}</p>}

        {!loading && !error && (
          <>
            <Card className="border-border bg-surface">
              <CardHeader className="border-border"><CardTitle className="text-foreground">Plan pricing</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {plans.map((plan) => (
                    <div key={plan.id} className="rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold">{plan.name}</p>
                        {!plan.active && <Badge variant="neutral">Retired</Badge>}
                      </div>
                      <p className="mt-1 text-2xl font-bold text-amber-400">
                        {plan.minPriceKes != null && Number(plan.minPriceKes) < Number(plan.priceKes) ? `KES ${Number(plan.minPriceKes).toLocaleString()} - ` : "KES "}
                        {Number(plan.priceKes).toLocaleString()}
                        <span className="text-xs font-normal text-secondary-500">{plan.billingCycle === "SEASONAL" ? "/year" : `/${plan.billingPeriodDays}d`}</span>
                      </p>
                      {plan.billingCycle !== "SEASONAL" && plan.annualPriceKes != null && (
                        <p className="text-sm">KES {Number(plan.annualPriceKes).toLocaleString()} a year{plan.instalmentCount ? ` or ${plan.instalmentCount} × ${Number(plan.instalmentKes).toLocaleString()}` : ""}</p>
                      )}
                      {plan.billingCycle === "SEASONAL" && plan.instalmentCount ? <p className="text-sm">{plan.instalmentCount} termly instalments of KES {Number(plan.instalmentKes).toLocaleString()}</p> : null}
                      <p className="mt-1 text-xs text-secondary-500">
                        {plan.maxDevices} devices{plan.maxExtraTills > 0 ? ` (+${plan.maxExtraTills} extra at KES ${Number(plan.extraTillKes ?? 500).toLocaleString()}/mo or ${Number(plan.extraTillAnnualKes ?? 5000).toLocaleString()}/yr)` : ""} · {plan.maxBranches} branches
                      </p>
                      <button
                        onClick={() => { setEditingPlan(plan); setEditPrice(plan.priceKes); setEditMin(plan.minPriceKes ?? ""); setEditExtra(String(plan.maxExtraTills ?? 0)); setEditAnnual(plan.annualPriceKes ?? ""); setEditCount(plan.instalmentCount ? String(plan.instalmentCount) : ""); setEditEach(plan.instalmentKes ?? ""); setEditTill(plan.extraTillKes ?? "500"); setEditTillYear(plan.extraTillAnnualKes ?? "5000"); setPlanError(null); }}
                        className="mt-3 text-sm text-amber-400 hover:underline"
                      >
                        Edit price
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-surface">
              <CardHeader className="border-border"><CardTitle className="text-foreground">Overdue accounts</CardTitle></CardHeader>
              <CardContent>
                {overdue.length === 0 ? (
                  <EmptyState title="No overdue accounts" description="Every tenant is current on payment." />
                ) : (
                  <div className="space-y-2">
                    {overdue.map((org) => (
                      <div key={org.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div>
                          <p className="font-medium">{org.name}</p>
                          <p className="text-xs text-secondary-500">
                            {org.subscription!.planName} · KES {(org.subscription!.bill?.amount ?? org.subscription!.monthlyPriceKes).toLocaleString()} {org.subscription!.bill?.label ?? "a month"} · billed through {new Date(org.subscription!.currentPeriodEnd).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant={STATUS_VARIANT[org.subscription!.status]}>{org.subscription!.status}</Badge>
                          <button
                            onClick={() => { setPayingOrg(org); setPayAmount(String(org.subscription!.bill?.amount ?? org.subscription!.monthlyPriceKes)); }}
                            className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
                          >
                            Record payment
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Modal open={!!editingPlan} onClose={() => setEditingPlan(null)} title={editingPlan ? `Edit ${editingPlan.name} price` : ""}>
          <label className="mb-1.5 block text-sm text-secondary-500">{editingPlan?.billingCycle === "SEASONAL" ? "Price a year (KES)" : "Price a month (KES)"}</label>
          <Input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
          {editingPlan?.billingCycle !== "SEASONAL" && (
            <>
              <label className="mb-1.5 mt-3 block text-sm text-secondary-500">Price a year, paid at once (KES)</label>
              <Input type="number" value={editAnnual} onChange={(e) => setEditAnnual(e.target.value)} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-sm text-secondary-500">Yearly instalments</label>
              <Input type="number" min={2} value={editCount} onChange={(e) => setEditCount(e.target.value)} placeholder="None" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-secondary-500">Each instalment (KES)</label>
              <Input type="number" value={editEach} onChange={(e) => setEditEach(e.target.value)} />
            </div>
          </div>
            </>
          )}
          {editingPlan?.billingCycle !== "SEASONAL" && (
            <>
              <label className="mb-1.5 mt-3 block text-sm text-secondary-500">Lowest price a team member may agree (KES, optional)</label>
              <Input type="number" value={editMin} onChange={(e) => setEditMin(e.target.value)} placeholder="Leave empty for one fixed price" />
              <p className="mt-1 text-xs text-secondary-500">
                With a lowest price, the team member onboarding a business chooses its monthly price between the two (for self-registered
                businesses, you set it on the business&apos;s page). Prices already agreed stay as they are.
              </p>
              <label className="mb-1.5 mt-3 block text-sm text-secondary-500">Extra tills a business may add</label>
              <Input type="number" min={0} value={editExtra} onChange={(e) => setEditExtra(e.target.value)} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1.5 block text-sm text-secondary-500">Extra till a month (KES)</label>
                  <Input type="number" value={editTill} onChange={(e) => setEditTill(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-secondary-500">Extra till a year (KES)</label>
                  <Input type="number" value={editTillYear} onChange={(e) => setEditTillYear(e.target.value)} />
                </div>
              </div>
              <p className="mt-1 text-xs text-secondary-500">A business on an old agreed price pays its own till price for an extra till.</p>
            </>
          )}
          {planError && <p className="mt-2 text-sm text-error-600">{planError}</p>}
          <ModalFooter>
            <Button onClick={() => setEditingPlan(null)} variant="secondary">Cancel</Button>
            <Button onClick={() => void savePlanPrice()} disabled={savingPlan}>{savingPlan ? "Saving..." : "Save"}</Button>
          </ModalFooter>
        </Modal>

        <Modal open={!!payingOrg} onClose={() => setPayingOrg(null)} title={payingOrg ? `Record payment - ${payingOrg.name}` : ""}>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm text-secondary-500">Amount (KES)</label>
              <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-secondary-500">Method</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full rounded-md border border-border bg-surface p-2.5 text-sm">
                <option value="MPESA">M-Pesa</option>
                <option value="BANK">Bank transfer</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-secondary-500">Reference (optional)</label>
              <Input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="M-Pesa code, cheque #, etc." />
            </div>
            {payError && <p className="text-sm text-error-600">{payError}</p>}
          </div>
          <ModalFooter>
            <Button onClick={() => setPayingOrg(null)} variant="secondary">Cancel</Button>
            <Button onClick={() => void recordPayment()} disabled={recording}>{recording ? "Recording..." : "Record payment"}</Button>
          </ModalFooter>
        </Modal>
      </main>
    </div>
  );
}
