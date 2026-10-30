"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

type Limits = { activeProjects: number | null; workers: number | null; users: number | null };
interface Plan { id: string; code: string; name: string; fits: string | null; monthlyPrice: string; annualPrice: string | null; quoteOnly: boolean; setupFee: string | null; setupFeeOptional: boolean; limits: Limits; features: string[]; sortOrder: number; isActive: boolean }
interface Coupon { id: string; code: string; description: string | null; percentOff: number; months: number; validUntil: string | null; maxUses: number | null; uses: number; isActive: boolean }
interface Tenant { id: string; name: string; planCode: string | null; planName: string | null; cycle: string | null; status: string | null; currentPeriodEnd: string | null; couponCode: string | null; paidPaymentsCount: number; mrr: number }
interface Tenants { tenants: Tenant[]; perPlan: { code: string; name: string; active: number; trial: number }[]; mrr: number }

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const input = "w-full rounded border border-border bg-background px-2 py-1 text-sm";
const toLimit = (v: string) => (v.trim() === "" ? null : Number(v));

/** Construction plans are data: prices, limits and features are edited here, never in code (docs/construction/05). */
export default function ConstructionAdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [tenants, setTenants] = useState<Tenants | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [coupon, setCoupon] = useState({ code: "", description: "", percentOff: "50", months: "2", maxUses: "" });

  const load = async () => {
    try {
      const [p, c, t] = await Promise.all([apiGet<Plan[]>("/platform-admin/construction/plans"), apiGet<Coupon[]>("/platform-admin/construction/coupons"), apiGet<Tenants>("/platform-admin/construction/tenants")]);
      setPlans(p);
      setCoupons(c);
      setTenants(t);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load construction billing.");
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
        <h1 className="text-xl font-bold">Construction plans & tenants</h1>
        {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {notice && <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

        {tenants && (
          <section className="rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">MRR {kes(tenants.mrr)}</h2>
            <p className="mt-1 text-sm text-secondary-600">{tenants.perPlan.map((p) => `${p.name}: ${p.active} paying, ${p.trial} on trial`).join(" · ")}</p>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="font-semibold">Plans</h2>
          {plans.map((p) => <PlanRow key={p.code} plan={p} onSave={(body) => act(() => apiPatch(`/platform-admin/construction/plans/${p.code}`, body), `${p.name} saved`)} />)}
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Coupons</h2>
          <ul className="mt-2 divide-y divide-border text-sm">
            {coupons.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><strong>{c.code}</strong> - {c.percentOff}% off {c.months} month(s){c.description ? ` · ${c.description}` : ""} · used {c.uses}{c.maxUses ? `/${c.maxUses}` : ""}{c.isActive ? "" : " · off"}</span>
                <button type="button" className="text-xs underline" onClick={() => act(() => apiPost("/platform-admin/construction/coupons", { code: c.code, description: c.description ?? undefined, percentOff: c.percentOff, months: c.months, maxUses: c.maxUses ?? undefined, isActive: !c.isActive }), `${c.code} ${c.isActive ? "switched off" : "switched on"}`)}>
                  {c.isActive ? "Switch off" : "Switch on"}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-6">
            <input className={input} placeholder="CODE" value={coupon.code} onChange={(e) => setCoupon({ ...coupon, code: e.target.value.toUpperCase() })} />
            <input className={`${input} sm:col-span-2`} placeholder="Description" value={coupon.description} onChange={(e) => setCoupon({ ...coupon, description: e.target.value })} />
            <input className={input} placeholder="% off" value={coupon.percentOff} onChange={(e) => setCoupon({ ...coupon, percentOff: e.target.value })} />
            <input className={input} placeholder="Months" value={coupon.months} onChange={(e) => setCoupon({ ...coupon, months: e.target.value })} />
            <button type="button" className="rounded bg-primary-600 px-3 py-1 text-sm text-white" onClick={() => act(() => apiPost("/platform-admin/construction/coupons", { code: coupon.code, description: coupon.description || undefined, percentOff: Number(coupon.percentOff), months: Number(coupon.months), maxUses: coupon.maxUses ? Number(coupon.maxUses) : undefined }), `${coupon.code} saved`)}>
              Save coupon
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Construction tenants</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-secondary-500">
                <tr><th className="py-1">Business</th><th>Plan</th><th>Status</th><th>Paid to</th><th>MRR</th><th>Payments</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tenants?.tenants.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2">{t.name}</td>
                    <td>{t.planName ?? "-"}{t.cycle === "ANNUAL" ? " (annual)" : ""}{t.couponCode ? ` · ${t.couponCode}` : ""}</td>
                    <td>{t.status ?? "not opened yet"}</td>
                    <td>{t.currentPeriodEnd ? new Date(t.currentPeriodEnd).toLocaleDateString("en-KE") : "-"}</td>
                    <td>{kes(t.mrr)}</td>
                    <td>{t.paidPaymentsCount}</td>
                    <td className="space-x-2 whitespace-nowrap text-xs">
                      {t.status === "TRIAL" && (
                        <button type="button" className="underline" onClick={() => { const d = prompt("Extend the trial by how many days?", "14"); if (d) void act(() => apiPost(`/platform-admin/construction/tenants/${t.id}/extend-trial`, { days: Number(d) }), `Trial extended for ${t.name}`); }}>Extend trial</button>
                      )}
                      {t.status && !t.couponCode && (
                        <button type="button" className="underline" onClick={() => { const c = prompt("Coupon code"); if (c) void act(() => apiPost(`/platform-admin/construction/tenants/${t.id}/coupon`, { code: c.trim().toUpperCase() }), `Coupon applied to ${t.name}`); }}>Coupon</button>
                      )}
                      {t.status && (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            const planCode = prompt("Plan code (CON_FUNDI, CON_CONTRACTOR, CON_PRO, CON_ENTERPRISE)", t.planCode ?? "CON_CONTRACTOR");
                            const cycle = planCode && prompt("MONTHLY or ANNUAL", "MONTHLY");
                            const amount = cycle && prompt("Amount received (KES)");
                            const reference = amount && prompt("Bank / M-Pesa reference");
                            if (planCode && cycle && amount) void act(() => apiPost(`/platform-admin/construction/tenants/${t.id}/payments`, { planCode, cycle: cycle.toUpperCase(), amount: Number(amount), method: "BANK", reference: reference || undefined }), `Payment recorded for ${t.name}`);
                          }}
                        >
                          Record payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function PlanRow({ plan, onSave }: { plan: Plan; onSave: (body: unknown) => void }) {
  const [f, setF] = useState({
    name: plan.name,
    monthlyPrice: String(Number(plan.monthlyPrice)),
    annualPrice: plan.annualPrice === null ? "" : String(Number(plan.annualPrice)),
    setupFee: plan.setupFee === null ? "" : String(Number(plan.setupFee)),
    setupFeeOptional: plan.setupFeeOptional,
    activeProjects: plan.limits.activeProjects === null ? "" : String(plan.limits.activeProjects),
    workers: plan.limits.workers === null ? "" : String(plan.limits.workers),
    users: plan.limits.users === null ? "" : String(plan.limits.users),
    features: plan.features.join(", "),
    isActive: plan.isActive,
  });
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-secondary-500">{plan.code}{plan.quoteOnly ? " · priced by quote" : ""}{plan.fits ? ` · ${plan.fits}` : ""} · blank limit = unlimited</p>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-9">
        <label>Name<input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Monthly<input className={input} value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} /></label>
        <label>Annual<input className={input} value={f.annualPrice} onChange={(e) => setF({ ...f, annualPrice: e.target.value })} /></label>
        <label>Setup fee<input className={input} value={f.setupFee} onChange={(e) => setF({ ...f, setupFee: e.target.value })} /></label>
        <label>Projects<input className={input} value={f.activeProjects} onChange={(e) => setF({ ...f, activeProjects: e.target.value })} /></label>
        <label>Workers<input className={input} value={f.workers} onChange={(e) => setF({ ...f, workers: e.target.value })} /></label>
        <label>Users<input className={input} value={f.users} onChange={(e) => setF({ ...f, users: e.target.value })} /></label>
        <label className="flex items-end gap-1"><input type="checkbox" checked={f.setupFeeOptional} onChange={(e) => setF({ ...f, setupFeeOptional: e.target.checked })} /> Setup optional</label>
        <label className="flex items-end gap-1"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Offered</label>
      </div>
      <label className="mt-2 block text-xs">Features (comma separated)<input className={input} value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} /></label>
      <button
        type="button"
        className="mt-2 rounded bg-primary-600 px-3 py-1 text-sm text-white"
        onClick={() =>
          onSave({
            name: f.name,
            monthlyPrice: Number(f.monthlyPrice),
            annualPrice: f.annualPrice.trim() === "" ? null : Number(f.annualPrice),
            setupFee: f.setupFee.trim() === "" ? null : Number(f.setupFee),
            setupFeeOptional: f.setupFeeOptional,
            limits: { activeProjects: toLimit(f.activeProjects), workers: toLimit(f.workers), users: toLimit(f.users) },
            features: f.features.split(",").map((x) => x.trim()).filter(Boolean),
            isActive: f.isActive,
          })
        }
      >
        Save {plan.name}
      </button>
    </div>
  );
}
