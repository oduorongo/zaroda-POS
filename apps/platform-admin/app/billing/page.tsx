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
  billingPeriodDays: number;
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
    setSavingPlan(true);
    try {
      await apiPatch(`/platform-admin/plans/${editingPlan.id}`, { priceKes: price });
      setEditingPlan(null);
      await load();
    } catch {
      // Inline error omitted here for brevity - the modal simply stays open on failure.
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Nav session={session} />
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-xl font-bold">Billing</h1>

        {loading && <LoadingState label="Loading billing data..." />}
        {!loading && error && <p className="text-sm text-error-500">{error}</p>}

        {!loading && !error && (
          <>
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="border-zinc-800"><CardTitle className="text-zinc-100">Plan pricing</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  {plans.map((plan) => (
                    <div key={plan.id} className="rounded-lg border border-zinc-800 p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold">{plan.name}</p>
                        {!plan.active && <Badge variant="neutral">Retired</Badge>}
                      </div>
                      <p className="mt-1 text-2xl font-bold text-amber-400">
                        KES {Number(plan.priceKes).toLocaleString()}
                        <span className="text-xs font-normal text-zinc-500">/{plan.billingPeriodDays}d</span>
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">{plan.maxDevices} devices · {plan.maxBranches} branches</p>
                      <button
                        onClick={() => { setEditingPlan(plan); setEditPrice(plan.priceKes); }}
                        className="mt-3 text-sm text-amber-400 hover:underline"
                      >
                        Edit price
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader className="border-zinc-800"><CardTitle className="text-zinc-100">Overdue accounts</CardTitle></CardHeader>
              <CardContent>
                {overdue.length === 0 ? (
                  <EmptyState title="No overdue accounts" description="Every tenant is current on payment." />
                ) : (
                  <div className="space-y-2">
                    {overdue.map((org) => (
                      <div key={org.id} className="flex items-center justify-between rounded-lg border border-zinc-800 p-3">
                        <div>
                          <p className="font-medium">{org.name}</p>
                          <p className="text-xs text-zinc-500">
                            {org.subscription!.planName} · billed through {new Date(org.subscription!.currentPeriodEnd).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant={STATUS_VARIANT[org.subscription!.status]}>{org.subscription!.status}</Badge>
                          <button
                            onClick={() => setPayingOrg(org)}
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
          <label className="mb-1.5 block text-sm text-secondary-500">Price (KES / period)</label>
          <Input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
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
