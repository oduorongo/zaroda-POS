"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import { CON_BRAND, errorText, hasConRole, kes, type ConStatus } from "../../../lib/construction";
import { ConShell, useConMe } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../components/construction/ui";

type Limits = { activeProjects: number | null; workers: number | null; users: number | null };
interface Plan { code: string; name: string; monthlyPrice: number; annualPrice: number | null; quoteOnly: boolean; setupFee: number | null; setupFeeOptional: boolean; limits: Limits; features: string[] }
interface Payment { id: string; planCode: string; cycle: string; amount: number; discount: number; status: "PENDING" | "PAID" | "FAILED"; method: string; receipt: string | null; error: string | null; createdAt: string; periodEndAfter: string | null }
interface Mine {
  planCode: string; planName: string; cycle: string; status: ConStatus; currentPeriodEnd: string; daysLeft: number; graceEndsAt: string;
  extraProjects: number; couponCode: string | null; couponMonthsLeft: number; limits: Limits; usage: Limits; plans: Plan[]; payments: Payment[]; canPayOnline: boolean;
}
interface Quote { months: number; gross: number; discount: number; amount: number; coupon: string | null }

const limit = (n: number | null) => (n === null ? "Unlimited" : n);

export default function PlanPage() {
  return (
    <ConShell title="Plan & billing">
      <PlanScreen />
    </ConShell>
  );
}

function PlanScreen() {
  const me = useConMe();
  const canPay = hasConRole(me, "CON_ACCOUNTANT");
  const [mine, setMine] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planCode, setPlanCode] = useState("");
  const [cycle, setCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [coupon, setCoupon] = useState("");
  const [extra, setExtra] = useState(0);
  const [phone, setPhone] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await apiGet<Mine>("/construction/plan");
      setMine(m);
      setPlanCode((p) => p || m.planCode);
      setExtra((x) => x || m.extraProjects);
    } catch (e) {
      setError(errorText(e, "Could not load your plan."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const plan = mine?.plans.find((p) => p.code === planCode);
    if (!plan || plan.quoteOnly) return setQuote(null);
    const extras = plan.features.includes("extra_projects") ? extra : 0;
    const q = new URLSearchParams({ planCode, cycle, extraProjects: String(extras), ...(coupon.trim() ? { couponCode: coupon.trim() } : {}) });
    const t = setTimeout(() => apiGet<Quote>(`/construction/plan/quote?${q}`).then((r) => (setQuote(r), setError(null))).catch((e) => (setQuote(null), setError(errorText(e, "Could not price that.")))), 300);
    return () => clearTimeout(t);
  }, [mine, planCode, cycle, coupon, extra]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const p = await apiPost<Payment>("/construction/plan/pay", { planCode, cycle, phone, couponCode: coupon.trim() || undefined, extraProjects: selected?.features.includes("extra_projects") ? extra : 0 });
      setNotice(p.status === "FAILED" ? null : "Check your phone and enter your M-Pesa PIN. This page updates once the payment arrives.");
      if (p.status === "FAILED") setError(p.error);
      await load();
    } catch (e) {
      setError(errorText(e, "Could not start the payment."));
    } finally {
      setBusy(false);
    }
  }

  const check = (id: string) => apiPost<Payment>(`/construction/plan/payments/${id}/check`, {}).then(load).catch((e) => setError(errorText(e, "Could not check.")));

  if (!mine) return <ErrorBox message={error} />;
  const selected = mine.plans.find((p) => p.code === planCode);

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <Panel title="Current plan">
        <p className="text-lg font-bold" style={{ color: "var(--con-ink)" }}>{mine.planName} {mine.cycle === "ANNUAL" ? "(annual)" : ""}</p>
        <p className="text-sm text-secondary-600">
          {mine.status === "TRIAL" && `Free trial - ends ${new Date(mine.currentPeriodEnd).toLocaleDateString("en-KE")} (${Math.max(mine.daysLeft, 0)} days left)`}
          {mine.status === "ACTIVE" && `Paid to ${new Date(mine.currentPeriodEnd).toLocaleDateString("en-KE")}`}
          {mine.status === "GRACE" && `Overdue - full access until ${new Date(mine.graceEndsAt).toLocaleDateString("en-KE")}, then read-only`}
          {(mine.status === "SUSPENDED" || mine.status === "CANCELLED") && "Read-only: pay to continue. Nothing has been deleted and exports still work."}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          {(["users", "activeProjects", "workers"] as const).map((k) => (
            <div key={k} className="rounded-lg bg-background p-2">
              <p className="font-bold">{mine.usage[k]} / {limit(mine.limits[k])}</p>
              <p className="text-xs text-secondary-500">{k === "users" ? "Staff users" : k === "activeProjects" ? "Active projects" : "Workers"}</p>
            </div>
          ))}
        </div>
        {mine.couponCode && <p className="mt-2 text-xs text-secondary-500">Coupon {mine.couponCode}: {mine.couponMonthsLeft} discounted month(s) left.</p>}
        <p className="mt-2 text-xs text-secondary-500">Client, consultant and subcontractor portal users are free and never count toward limits.</p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {mine.plans.map((p) => {
          const on = p.code === planCode;
          return (
            <button key={p.code} type="button" onClick={() => setPlanCode(p.code)} className="rounded-xl border-2 bg-surface p-3 text-left" style={{ borderColor: on ? CON_BRAND.gold : "transparent", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <p className="font-bold" style={{ color: "var(--con-ink)" }}>{p.name}{p.code === mine.planCode && " · current"}</p>
              <p className="text-sm">{p.quoteOnly ? `From ${kes(p.monthlyPrice)}/month` : `${kes(p.monthlyPrice)}/month`}</p>
              {!p.quoteOnly && p.annualPrice !== null && <p className="text-xs text-secondary-500">{kes(p.annualPrice)}/year (12 for 10)</p>}
              <p className="mt-2 text-xs text-secondary-600">{limit(p.limits.activeProjects)} projects · {limit(p.limits.workers)} workers · {limit(p.limits.users)} users</p>
              {p.setupFee !== null && <p className="text-xs text-secondary-500">Setup {kes(p.setupFee)}{p.setupFeeOptional ? " (optional)" : ""}</p>}
            </button>
          );
        })}
      </div>

      {selected?.quoteOnly ? (
        <Panel><p className="text-sm">Enterprise is priced by quote. Contact ZARODA to set it up.</p></Panel>
      ) : (
        canPay && (
          <Panel title="Pay by M-Pesa">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Billing">
                <select className={inputClass} value={cycle} onChange={(e) => setCycle(e.target.value as "MONTHLY" | "ANNUAL")}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="ANNUAL">Annual (pay 10, get 12)</option>
                </select>
              </Field>
              {selected?.features.includes("extra_projects") ? (
                <Field label="Extra projects (KES 1,500/month each)">
                  <input className={inputClass} type="number" min={0} max={100} value={extra} onChange={(e) => setExtra(Math.max(0, Number(e.target.value) || 0))} />
                </Field>
              ) : (
                <p className="self-end text-xs text-secondary-500">{selected?.name} has no extra projects - upgrade for more sites.</p>
              )}
              <Field label="Coupon">
                <input className={inputClass} value={coupon} placeholder={mine.couponCode ?? "e.g. PILOT50"} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
              </Field>
              <Field label="M-Pesa number">
                <input className={inputClass} inputMode="tel" value={phone} placeholder="0712 345 678" onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            {quote && (
              <p className="mt-3 text-sm">
                {quote.months} month(s): {kes(quote.gross)}{quote.discount > 0 && ` - ${kes(quote.discount)} coupon`} = <strong>{kes(quote.amount)}</strong>
              </p>
            )}
            <div className="mt-3">
              {mine.canPayOnline ? (
                <PrimaryButton disabled={busy || !quote || phone.trim().length < 9} onClick={pay}>{busy ? "Sending prompt..." : `Pay ${quote ? kes(quote.amount) : ""}`}</PrimaryButton>
              ) : (
                <p className="text-sm text-secondary-600">Online payment is not switched on yet. Contact ZARODA to pay by bank or M-Pesa.</p>
              )}
            </div>
          </Panel>
        )
      )}

      <Panel title="Payments">
        {mine.payments.length === 0 ? (
          <p className="text-sm text-secondary-500">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {mine.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{kes(p.amount)} · {p.planCode.replace("CON_", "")} {p.cycle.toLowerCase()}</p>
                  <p className="text-xs text-secondary-500">{new Date(p.createdAt).toLocaleString("en-KE")} · {p.method}{p.receipt ? ` · ${p.receipt}` : ""}{p.error ? ` · ${p.error}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: p.status === "PAID" ? "#16a34a" : p.status === "FAILED" ? "#dc2626" : CON_BRAND.orange }}>{p.status}</span>
                  {p.status === "PENDING" && canPay && (
                    <button type="button" className="text-xs underline" onClick={() => check(p.id)}>Check now</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
