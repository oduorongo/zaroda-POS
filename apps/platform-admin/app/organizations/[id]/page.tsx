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
  kraPin: string | null;
  vatRegistered: boolean;
  isActive: boolean;
  deactivatedAt: string | null;
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

const INDUSTRY_TYPES = ["RETAIL", "RESTAURANT", "PHARMACY", "SALON"] as const;

export default function OrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingSuspend, setTogglingSuspend] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editIndustryType, setEditIndustryType] = useState("RETAIL");
  const [editCountry, setEditCountry] = useState("");
  const [editBaseCurrency, setEditBaseCurrency] = useState("");
  const [editKraPin, setEditKraPin] = useState("");
  const [editVatRegistered, setEditVatRegistered] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deactivateConfirm, setDeactivateConfirm] = useState("");
  const [togglingActive, setTogglingActive] = useState(false);

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
      const result = await apiGet<OrganizationDetail>(`/platform-admin/organizations/${params.id}`);
      setOrg(result);
      resetEditFields(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this organization.");
    }
  }

  function resetEditFields(o: OrganizationDetail) {
    setEditName(o.name);
    setEditIndustryType(o.industryType);
    setEditCountry(o.country);
    setEditBaseCurrency(o.baseCurrency);
    setEditKraPin(o.kraPin ?? "");
    setEditVatRegistered(o.vatRegistered);
  }

  async function saveEdit() {
    if (!org || !editName.trim()) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      await apiPatch(`/platform-admin/organizations/${org.id}`, {
        name: editName.trim(),
        industryType: editIndustryType,
        country: editCountry.trim(),
        baseCurrency: editBaseCurrency.trim(),
        kraPin: editKraPin.trim() || undefined,
        vatRegistered: editVatRegistered,
      });
      setEditing(false);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSavingEdit(false);
    }
  }

  // The soft-delete "delete tenant" action - blocks login for everyone in
  // the org while preserving all its data (see PlatformAdminService's own
  // comment on why this is never a real DELETE). Deactivating requires
  // typing the org's name first since it's disruptive; reactivating does
  // not, since it's the safe direction.
  async function toggleActive() {
    if (!org) return;
    const nextActive = !org.isActive;
    if (!nextActive && deactivateConfirm.trim() !== org.name) return;
    setTogglingActive(true);
    setError(null);
    try {
      await apiPatch(`/platform-admin/organizations/${org.id}/active`, { isActive: nextActive });
      setDeactivateConfirm("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update tenant status.");
    } finally {
      setTogglingActive(false);
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
    <div className="min-h-screen bg-primary-900 text-zinc-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <button onClick={() => router.push("/organizations")} className="mb-4 text-amber-400 hover:underline">
          &larr; Tenants
        </button>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {!org && !error && <p className="text-zinc-400">Loading...</p>}
        {org && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold">{org.name}</h1>
                  {!org.isActive && <Badge variant="error">Deactivated</Badge>}
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {org.industryType} · {org.country} · {org.baseCurrency} · created {new Date(org.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {org.subscription && <Badge variant={STATUS_VARIANT[org.subscription.status]}>{org.subscription.status}</Badge>}
                <button
                  onClick={() => setEditing((v) => !v)}
                  className="rounded-md bg-primary-700 px-3 py-1.5 text-sm hover:bg-primary-600"
                >
                  {editing ? "Cancel" : "Edit"}
                </button>
              </div>
            </div>

            {editing && (
              <section className="mt-4 rounded-lg border border-primary-700 p-4">
                <h2 className="font-semibold">Edit tenant</h2>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs text-zinc-500">Business name</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-md border border-primary-600 bg-primary-950 p-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Industry</label>
                    <select
                      value={editIndustryType}
                      onChange={(e) => setEditIndustryType(e.target.value)}
                      className="w-full rounded-md border border-primary-600 bg-primary-950 p-2"
                    >
                      {INDUSTRY_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Country</label>
                    <input
                      value={editCountry}
                      onChange={(e) => setEditCountry(e.target.value)}
                      maxLength={2}
                      className="w-full rounded-md border border-primary-600 bg-primary-950 p-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Currency</label>
                    <input
                      value={editBaseCurrency}
                      onChange={(e) => setEditBaseCurrency(e.target.value)}
                      maxLength={3}
                      className="w-full rounded-md border border-primary-600 bg-primary-950 p-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">KRA PIN</label>
                    <input
                      value={editKraPin}
                      onChange={(e) => setEditKraPin(e.target.value)}
                      className="w-full rounded-md border border-primary-600 bg-primary-950 p-2"
                    />
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editVatRegistered}
                        onChange={(e) => setEditVatRegistered(e.target.checked)}
                        className="h-4 w-4"
                      />
                      VAT registered
                    </label>
                  </div>
                </div>
                {editError && <p className="mt-2 text-sm text-red-400">{editError}</p>}
                <button
                  onClick={() => void saveEdit()}
                  disabled={savingEdit || !editName.trim()}
                  className="mt-3 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
                >
                  {savingEdit ? "Saving..." : "Save changes"}
                </button>
              </section>
            )}

            <div className="mt-6 grid grid-cols-3 gap-3">
              <Stat label="Branches" value={String(org.branchCount)} />
              <Stat label="Staff" value={String(org.orgUserCount)} />
              <Stat label="Sales" value={String(org.saleCount)} />
            </div>

            <section className="mt-6 rounded-lg border border-primary-700">
              <h2 className="border-b border-primary-700 bg-primary-800 p-3 font-semibold">Subscription</h2>
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
                    <div className="mt-4 border-t border-primary-700 pt-3">
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

            <section className="mt-4 rounded-lg border border-primary-700">
              <h2 className="border-b border-primary-700 bg-primary-800 p-3 font-semibold">Branches</h2>
              {org.branches.length === 0 && <p className="p-3 text-sm text-zinc-500">None yet.</p>}
              {org.branches.map((b) => (
                <div key={b.id} className="border-b border-primary-700 p-3 text-sm last:border-b-0">
                  {b.name} {b.county && <span className="text-zinc-500">({b.county})</span>}
                </div>
              ))}
            </section>

            <section className="mt-4 rounded-lg border border-primary-700">
              <h2 className="border-b border-primary-700 bg-primary-800 p-3 font-semibold">Staff</h2>
              {org.orgUsers.length === 0 && <p className="p-3 text-sm text-zinc-500">None yet.</p>}
              {org.orgUsers.map((u) => (
                <div key={u.id} className="border-b border-primary-700 p-3 text-sm last:border-b-0">
                  <span className={u.isActive ? "" : "text-zinc-500 line-through"}>
                    {u.user.fullName} ({u.user.email})
                  </span>{" "}
                  <span className="text-zinc-500">- {u.role}</span>
                  {!u.isActive && <span className="ml-2 text-xs text-red-400">deactivated</span>}
                </div>
              ))}
            </section>

            <section className="mt-4 rounded-lg border border-red-900">
              <h2 className="border-b border-red-900 bg-red-950/40 p-3 font-semibold text-red-300">Danger zone</h2>
              <div className="p-3 text-sm">
                {org.isActive ? (
                  <>
                    <p className="text-zinc-400">
                      Deactivating blocks every login for this tenant - owner, managers, and cashiers alike -
                      immediately. Nothing is deleted; all sales, staff, and audit history stay intact and this
                      can be reversed at any time.
                    </p>
                    <label className="mb-1 mt-3 block text-xs text-zinc-500">
                      Type <span className="font-mono text-zinc-300">{org.name}</span> to confirm
                    </label>
                    <input
                      value={deactivateConfirm}
                      onChange={(e) => setDeactivateConfirm(e.target.value)}
                      className="w-full max-w-sm rounded-md border border-primary-600 bg-primary-950 p-2"
                    />
                    <div className="mt-3">
                      <button
                        onClick={() => void toggleActive()}
                        disabled={togglingActive || deactivateConfirm.trim() !== org.name}
                        className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
                      >
                        {togglingActive ? "..." : "Deactivate tenant"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-zinc-400">
                      This tenant is deactivated
                      {org.deactivatedAt && ` since ${new Date(org.deactivatedAt).toLocaleString()}`}. No one can
                      log in until it&apos;s reactivated.
                    </p>
                    <button
                      onClick={() => void toggleActive()}
                      disabled={togglingActive}
                      className="mt-3 rounded-md bg-success-600 px-4 py-2 text-sm font-semibold text-white hover:bg-success-700 disabled:opacity-40"
                    >
                      {togglingActive ? "..." : "Reactivate tenant"}
                    </button>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-primary-700 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-lg">{value}</p>
    </div>
  );
}
