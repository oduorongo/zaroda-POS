"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

type Limits = { head: number | null; birds: number | null; acres: number | null; users: number | null };
interface Plan { id: string; code: string; name: string; fits: string | null; monthlyPrice: string; annualPrice: string | null; quoteOnly: boolean; limits: Limits; features: string[]; sortOrder: number; isActive: boolean }
interface Tenant { id: string; name: string; phone: string | null; planCode: string | null; planName: string | null; cycle: string | null; status: string | null; currentPeriodEnd: string | null; smsCredits: number; paidPaymentsCount: number; feesOwed: number; mrr: number }
interface Tenants { tenants: Tenant[]; perPlan: { code: string; name: string; active: number; trial: number }[]; mrr: number; trialsEnding: number; feesOwed: number }

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const input = "w-full rounded border border-border bg-background px-2 py-1 text-sm";
const toLimit = (v: string) => (v.trim() === "" ? null : Number(v));
const LIMITS: (keyof Limits)[] = ["head", "birds", "acres", "users"];

function PlanRow({ plan, onSave }: { plan: Plan; onSave: (body: Record<string, unknown>) => void }) {
  const [f, setF] = useState({
    monthlyPrice: String(Number(plan.monthlyPrice)), annualPrice: plan.annualPrice === null ? "" : String(Number(plan.annualPrice)),
    head: plan.limits.head?.toString() ?? "", birds: plan.limits.birds?.toString() ?? "", acres: plan.limits.acres?.toString() ?? "", users: plan.limits.users?.toString() ?? "", isActive: plan.isActive,
  });
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-2">
        <b>{plan.name}</b>
        <span className="block text-xs text-secondary-500">{plan.code}{plan.quoteOnly ? " · quote" : ""}</span>
      </td>
      <td className="pr-2"><input className={input} value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} /></td>
      <td className="pr-2"><input className={input} value={f.annualPrice} placeholder="12 x" onChange={(e) => setF({ ...f, annualPrice: e.target.value })} /></td>
      {LIMITS.map((k) => (
        <td key={k} className="pr-2"><input className={input} value={f[k]} placeholder="∞" onChange={(e) => setF({ ...f, [k]: e.target.value })} /></td>
      ))}
      <td className="pr-2 text-center"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></td>
      <td>
        <button
          type="button"
          className="rounded bg-primary-600 px-3 py-1 text-sm text-white"
          onClick={() =>
            onSave({
              monthlyPrice: Number(f.monthlyPrice), annualPrice: f.annualPrice.trim() === "" ? null : Number(f.annualPrice), isActive: f.isActive,
              limits: { head: toLimit(f.head), birds: toLimit(f.birds), acres: toLimit(f.acres), users: toLimit(f.users) },
            })
          }
        >
          Save
        </button>
      </td>
    </tr>
  );
}

/** Zaroda Shamba plans are data: prices and limits are edited here. Farms, their status and MRR, trials and payments made outside M-Pesa. */
export default function FarmAdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<Tenants | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);

  const load = async () => {
    try {
      const [p, t] = await Promise.all([apiGet<Plan[]>("/platform-admin/farm/plans"), apiGet<Tenants>("/platform-admin/farm/tenants")]);
      setPlans(p);
      setTenants(t);
      setLoads((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load Shamba billing.");
    }
  };
  useEffect(() => {
    const s = getSession();
    if (!s) return router.replace("/login");
    setSession(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work.");
    }
  };

  if (!session) return null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-bold">Zaroda Shamba (farms)</h1>
          <p className="text-sm text-secondary-500">Plan prices and limits, farms and what they pay. SMS bundles and wage payout fee bands are shared with Construction (edit them there).</p>
        </div>
        {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {notice && <p className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-800">{notice}</p>}

        {tenants && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["MRR", kes(tenants.mrr)],
              ["Farms", String(tenants.tenants.length)],
              ["Trials ending this week", String(tenants.trialsEnding)],
              ["Fees owed to ZARODA", kes(tenants.feesOwed)],
            ].map(([t, v]) => (
              <div key={t} className="rounded border border-border p-3">
                <p className="text-xs text-secondary-500">{t}</p>
                <p className="text-lg font-bold">{v}</p>
              </div>
            ))}
          </div>
        )}

        <section className="rounded border border-border p-4">
          <h2 className="mb-2 font-semibold">Plans</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary-500">
                  <th>Plan</th>
                  <th>KES / month</th>
                  <th>KES / year</th>
                  <th>Head</th>
                  <th>Birds</th>
                  <th>Acres</th>
                  <th>Users</th>
                  <th>On sale</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <PlanRow key={`${p.code}-${loads}`} plan={p} onSave={(body) => act(() => apiPatch(`/platform-admin/farm/plans/${p.code}`, body), `${p.name} saved`)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-secondary-500">Leave a limit empty for unlimited, and the yearly price empty for 12 months at the monthly price. Changes reach farms within a minute.</p>
        </section>

        <section className="rounded border border-border p-4">
          <h2 className="mb-2 font-semibold">Farms</h2>
          {!tenants ? (
            <p className="text-sm text-secondary-500">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-secondary-500">
                    <th className="py-1">Farm</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Paid to</th>
                    <th>SMS</th>
                    <th>Fees owed</th>
                    <th>MRR</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tenants.tenants.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="py-1.5">
                        {t.name}
                        {t.phone ? <span className="block text-xs text-secondary-500">{t.phone}</span> : null}
                      </td>
                      <td>
                        {t.planName ?? "-"}
                        {t.cycle ? <span className="block text-xs text-secondary-500">{t.cycle.toLowerCase()}</span> : null}
                      </td>
                      <td>{t.status ?? "not opened"}</td>
                      <td>{t.currentPeriodEnd ? t.currentPeriodEnd.slice(0, 10) : "-"}</td>
                      <td>{t.smsCredits}</td>
                      <td>{t.feesOwed ? kes(t.feesOwed) : "-"}</td>
                      <td>{t.mrr ? kes(t.mrr) : "-"}</td>
                      <td className="space-x-2 whitespace-nowrap text-xs">
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            const d = prompt("Extend the trial by how many days?", "14");
                            if (d) void act(() => apiPost(`/platform-admin/farm/tenants/${t.id}/extend-trial`, { days: Number(d) }), `Trial extended for ${t.name}`);
                          }}
                        >
                          Extend trial
                        </button>
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            const planCode = prompt("Plan code (e.g. FARM_FARMER)", t.planCode ?? "FARM_FARMER");
                            const cycle = planCode ? prompt("MONTHLY or ANNUAL", "MONTHLY") : null;
                            const amount = cycle ? prompt("Amount received (KES)") : null;
                            const method = amount ? prompt("BANK, CHEQUE, CASH or MPESA", "BANK") : null;
                            const reference = method ? prompt("Reference (optional)") : null;
                            if (planCode && cycle && amount && method)
                              void act(() => apiPost(`/platform-admin/farm/tenants/${t.id}/payments`, { planCode, cycle: cycle.toUpperCase(), amount: Number(amount), method: method.toUpperCase(), reference: reference || undefined }), `Payment recorded for ${t.name}`);
                          }}
                        >
                          Record payment
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
