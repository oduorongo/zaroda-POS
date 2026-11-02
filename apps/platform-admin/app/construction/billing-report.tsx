"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../../lib/api";

interface TenantRow { id: string; name: string; planName: string | null; status: string | null; currentPeriodEnd: string | null; mrr: number }
interface Billing {
  mrr: number;
  perPlan: { code: string; name: string; active: number; trial: number; grace: number; suspended: number; mrr: number }[];
  trialsEnding: TenantRow[];
  grace: TenantRow[];
  suspended: TenantRow[];
  commissions: { organizationId: string; tenant: string; agent: string; team: string; rate: number; payments: number; firstYear: number; commission: number; payable: boolean }[];
  commissionDue: number;
  fees: { unpaidInvoices: number; total: number };
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-KE") : "-");

/** MRR, tenants per plan, trials ending this week, lapsed tenants and sales-agent commissions (docs/construction/05). */
export function BillingReport({ refresh }: { refresh: number }) {
  const [b, setB] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<Billing>("/platform-admin/construction/billing").then(setB).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the billing report."));
  }, [refresh]);
  if (error) return <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (!b) return null;
  const list = (rows: TenantRow[], empty: string) => (rows.length === 0 ? <p className="text-sm text-secondary-500">{empty}</p> : (
    <ul className="text-sm">{rows.map((t) => <li key={t.id}>{t.name} · {t.planName ?? "-"} · {t.status === "TRIAL" ? "trial ends" : "paid to"} {day(t.currentPeriodEnd)}</li>)}</ul>
  ));
  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-semibold">Billing report · MRR {kes(b.mrr)}</h2>
      <p className="text-sm text-secondary-600">Payout fees not yet paid: {kes(b.fees.total)} on {b.fees.unpaidInvoices} monthly invoice{b.fees.unpaidInvoices === 1 ? "" : "s"}.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-left text-secondary-600"><th className="py-1">Plan</th><th className="text-right">Paying</th><th className="text-right">Trial</th><th className="text-right">Grace</th><th className="text-right">Suspended</th><th className="text-right">MRR</th></tr></thead>
          <tbody>{b.perPlan.map((p) => <tr key={p.code} className="border-b border-border"><td className="py-1">{p.name}</td><td className="text-right">{p.active}</td><td className="text-right">{p.trial}</td><td className="text-right">{p.grace}</td><td className="text-right">{p.suspended}</td><td className="text-right">{kes(p.mrr)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div><h3 className="text-sm font-semibold">Trials ending in 7 days</h3>{list(b.trialsEnding, "None.")}</div>
        <div><h3 className="text-sm font-semibold">In grace (payment overdue)</h3>{list(b.grace, "None.")}</div>
        <div><h3 className="text-sm font-semibold">Suspended (read-only)</h3>{list(b.suspended, "None.")}</div>
      </div>
      <div>
        <h3 className="text-sm font-semibold">Agent commissions · payable now {kes(b.commissionDue)}</h3>
        {b.commissions.length === 0 ? <p className="text-sm text-secondary-500">No construction business was signed up by a sales agent yet.</p> : (
          <table className="mt-1 w-full text-sm">
            <thead><tr className="border-b border-border text-left text-secondary-600"><th className="py-1">Business</th><th>Agent (team)</th><th className="text-right">Payments</th><th className="text-right">First-year paid</th><th className="text-right">Rate</th><th className="text-right">Commission</th><th className="text-right">Status</th></tr></thead>
            <tbody>{b.commissions.map((c) => (
              <tr key={c.organizationId} className="border-b border-border"><td className="py-1">{c.tenant}</td><td>{c.agent} ({c.team})</td><td className="text-right">{c.payments}</td><td className="text-right">{kes(c.firstYear)}</td><td className="text-right">{Math.round(c.rate * 100)}%</td><td className="text-right">{kes(c.commission)}</td><td className="text-right">{c.payable ? "Payable" : "After 2nd payment"}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
