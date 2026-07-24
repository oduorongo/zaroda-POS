"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { Badge } from "@zaroda/ui";

interface Branch {
  id: string;
  name: string;
  county: string | null;
}

interface OrgUserRow {
  id: string;
  role: string;
  isActive: boolean;
  user: { fullName: string; email: string };
}

interface SubscriptionPayment {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: string;
}

interface Subscription {
  id: string;
  currentPeriodEnd: string;
  graceDays: number;
  isTrial: boolean;
  manuallySuspended: boolean;
  status: "TRIAL" | "ACTIVE" | "GRACE" | "SUSPENDED";
  plan: { name: string; tier: string; priceKes: string };
  payments: SubscriptionPayment[];
}

interface OrganizationDetail {
  id: string;
  name: string;
  industryType: string;
  country: string;
  baseCurrency: string;
  createdAt: string;
  branchCount: number;
  orgUserCount: number;
  saleCount: number;
  branches: Branch[];
  orgUsers: OrgUserRow[];
  subscription: Subscription | null;
}

const STATUS_VARIANT: Record<string, "primary" | "success" | "warning" | "error" | "neutral"> = {
  TRIAL: "primary",
  ACTIVE: "success",
  GRACE: "warning",
  SUSPENDED: "error",
};

export default function OrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingSuspend, setTogglingSuspend] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, params.id]);

  async function load() {
    try {
      setOrg(await apiGet<OrganizationDetail>(`/platform-admin/organizations/${params.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this organization.");
    }
  }

  async function toggleSuspend() {
    if (!org?.subscription) return;
    setTogglingSuspend(true);
    try {
      await apiPatch(`/platform-admin/organizations/${org.id}/suspension`, {
        suspended: !org.subscription.manuallySuspended,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update suspension.");
    } finally {
      setTogglingSuspend(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <button onClick={() => router.push("/organizations")} className="mb-4 text-amber-400 hover:underline">
          &larr; Tenants
        </button>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {!org && !error && <p className="text-zinc-400">Loading...</p>}
        {org && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold">{org.name}</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  {org.industryType} · {org.country} · {org.baseCurrency} · created {new Date(org.createdAt).toLocaleString()}
                </p>
              </div>
              {org.subscription && <Badge variant={STATUS_VARIANT[org.subscription.status]}>{org.subscription.status}</Badge>}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <Stat label="Branches" value={String(org.branchCount)} />
              <Stat label="Staff" value={String(org.orgUserCount)} />
              <Stat label="Sales" value={String(org.saleCount)} />
            </div>

            <section className="mt-6 rounded-lg border border-zinc-800">
              <h2 className="border-b border-zinc-800 bg-zinc-900 p-3 font-semibold">Subscription</h2>
              {!org.subscription ? (
                <p className="p-3 text-sm text-zinc-500">No subscription on record.</p>
              ) : (
                <div className="p-3 text-sm">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div><p className="text-xs text-zinc-500">Plan</p><p>{org.subscription.plan.name}</p></div>
                    <div><p className="text-xs text-zinc-500">Price</p><p>KES {Number(org.subscription.plan.priceKes).toLocaleString()}</p></div>
                    <div><p className="text-xs text-zinc-500">Billed through</p><p>{new Date(org.subscription.currentPeriodEnd).toLocaleDateString()}</p></div>
                    <div><p className="text-xs text-zinc-500">Grace period</p><p>{org.subscription.graceDays} days</p></div>
                  </div>
                  <button
                    onClick={() => void toggleSuspend()}
                    disabled={togglingSuspend}
                    className={`mt-4 rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-40 ${
                      org.subscription.manuallySuspended ? "bg-success-600 text-white hover:bg-success-700" : "bg-error-600 text-white hover:bg-error-700"
                    }`}
                  >
                    {togglingSuspend ? "..." : org.subscription.manuallySuspended ? "Reactivate tenant" : "Suspend tenant"}
                  </button>

                  {org.subscription.payments.length > 0 && (
                    <div className="mt-4 border-t border-zinc-800 pt-3">
                      <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Payment history</p>
                      <div className="space-y-1">
                        {org.subscription.payments.map((p) => (
                          <div key={p.id} className="flex justify-between text-xs text-zinc-400">
                            <span>{new Date(p.paidAt).toLocaleDateString()} · {p.method}{p.reference ? ` (${p.reference})` : ""}</span>
                            <span className="font-mono text-zinc-200">KES {Number(p.amount).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="mt-4 rounded-lg border border-zinc-800">
              <h2 className="border-b border-zinc-800 bg-zinc-900 p-3 font-semibold">Branches</h2>
              {org.branches.length === 0 && <p className="p-3 text-sm text-zinc-500">None yet.</p>}
              {org.branches.map((b) => (
                <div key={b.id} className="border-b border-zinc-800 p-3 text-sm last:border-b-0">
                  {b.name} {b.county && <span className="text-zinc-500">({b.county})</span>}
                </div>
              ))}
            </section>

            <section className="mt-4 rounded-lg border border-zinc-800">
              <h2 className="border-b border-zinc-800 bg-zinc-900 p-3 font-semibold">Staff</h2>
              {org.orgUsers.length === 0 && <p className="p-3 text-sm text-zinc-500">None yet.</p>}
              {org.orgUsers.map((u) => (
                <div key={u.id} className="border-b border-zinc-800 p-3 text-sm last:border-b-0">
                  <span className={u.isActive ? "" : "text-zinc-500 line-through"}>
                    {u.user.fullName} ({u.user.email})
                  </span>{" "}
                  <span className="text-zinc-500">- {u.role}</span>
                  {!u.isActive && <span className="ml-2 text-xs text-red-400">deactivated</span>}
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-lg">{value}</p>
    </div>
  );
}
