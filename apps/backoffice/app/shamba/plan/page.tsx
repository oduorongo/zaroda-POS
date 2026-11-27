"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { SHAMBA_BRAND, SHAMBA_INK, STATUS_LABEL, inputClass, limitText } from "../../../lib/shamba";

type Cycle = "MONTHLY" | "ANNUAL";
interface PlanOffer { code: string; name: string; monthlyPrice: number; annualPrice: number | null; quoteOnly: boolean; limits: { head: number | null; birds: number | null; acres: number | null; users: number | null } }
interface Payment { id: string; purpose: "PLAN" | "SMS" | "FEES"; planCode: string; cycle: string; amount: number; status: "PENDING" | "PAID" | "FAILED"; error: string | null; method: string | null; receipt: string | null; paidAt: string | null; createdAt: string }
interface Billing {
  planCode: string;
  status: keyof typeof STATUS_LABEL;
  cycle: string;
  currentPeriodEnd: string;
  smsCredits: number;
  plans: PlanOffer[];
  usage: { head: number; birds: number; acres: number; users: number };
  smsBundles: { code: string; name: string; sms: number; price: number }[];
  payoutBands: { upTo: number | null; fee: number }[];
  feesThisMonth: { count: number; total: number };
  invoices: { id: string; periodMonth: string; total: number; status: string; paidAt: string | null }[];
  payments: Payment[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const PURPOSE = { PLAN: "Plan", SMS: "SMS bundle", FEES: "ZARODA fees" };
const priceOf = (p: PlanOffer, cycle: Cycle) => (cycle === "ANNUAL" ? p.annualPrice ?? p.monthlyPrice * 12 : p.monthlyPrice);

export default function PlanPage() {
  const [b, setB] = useState<Billing | null>(null);
  const [cycle, setCycle] = useState<Cycle>("ANNUAL");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiGet<Billing>("/farm/plan").then(setB).catch((err) => setError(errText(err, "Could not load your plan")));
  useEffect(() => {
    void load();
  }, []);

  async function start(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiPost<Payment & { switched?: boolean }>(path, { ...body, phone: phone.trim() || undefined });
      if (r.switched) {
        setNotice("Switched. The free plan has no end date.");
        await load();
      } else if (r.status === "FAILED") setError(r.error ?? "The M-Pesa prompt could not be sent");
      else {
        setPending(r);
        setNotice(`An M-Pesa prompt for ${kes(r.amount)} is on ${phone}. Enter your PIN, then press "I have paid".`);
      }
    } catch (err) {
      setError(errText(err, "Could not start the payment"));
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (!pending) return;
    setError(null);
    try {
      const r = await apiGet<Payment>(`/farm/plan/payments/${pending.id}`);
      if (r.status === "PAID") {
        setPending(null);
        setNotice(`Paid${r.receipt ? ` (${r.receipt})` : ""}. Thank you.`);
        await load();
      } else if (r.status === "FAILED") {
        setPending(null);
        setError(r.error ?? "The payment did not go through");
      } else setNotice("Not received yet. Wait a few seconds after entering your PIN, then check again.");
    } catch (err) {
      setError(errText(err, "Could not check"));
    }
  }

  return (
    <ShambaAppFrame>
      {() =>
        !b ? (
          error ? <ErrorBox error={error} /> : <p className="text-sm text-secondary-500">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>Plan &amp; billing</h1>
              <p className="text-sm text-secondary-600">
                {b.plans.find((p) => p.code === b.planCode)?.name ?? b.planCode} · <b>{STATUS_LABEL[b.status]}</b>
                {b.status !== "SUSPENDED" ? ` until ${b.currentPeriodEnd.slice(0, 10)}` : ""} · {b.cycle === "ANNUAL" ? "paid yearly" : "paid monthly"}
              </p>
            </div>
            <ErrorBox error={error} />
            {notice && <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: SHAMBA_BRAND.gold, background: "#fbf6e3", color: SHAMBA_INK }}>{notice}</p>}
            {pending && (
              <Btn type="button" tone="navy" onClick={() => void check()}>
                I have paid - check
              </Btn>
            )}

            <Card>
              <label className="block max-w-xs text-sm">
                M-Pesa number to pay from
                <input className={inputClass} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
              </label>
            </Card>

            <Card title="Choose a plan">
              <div className="mb-3 flex gap-1">
                {(["ANNUAL", "MONTHLY"] as Cycle[]).map((c) => (
                  <button key={c} type="button" onClick={() => setCycle(c)} className="rounded-lg border px-3 py-1.5 text-sm font-semibold" style={cycle === c ? { background: SHAMBA_BRAND.navy, color: "white", borderColor: SHAMBA_BRAND.navy } : { borderColor: "#cbd5e1", color: SHAMBA_INK }}>
                    {c === "MONTHLY" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {b.plans.map((p) => {
                  const current = p.code === b.planCode;
                  const price = priceOf(p, cycle);
                  return (
                    <div key={p.code} className="rounded-xl border p-3" style={{ borderColor: current ? SHAMBA_BRAND.gold : "#e2e8f0" }}>
                      <p className="font-semibold" style={{ color: SHAMBA_INK }}>
                        {p.name} {current && <span className="text-xs font-normal">(your plan)</span>}
                      </p>
                      <p className="text-lg font-bold">{p.quoteOnly ? "By quote" : price ? `${kes(price)} ${cycle === "ANNUAL" ? "a year" : "a month"}` : "Free"}</p>
                      <p className="text-xs text-secondary-500">
                        {limitText(p.limits.head)} head · {limitText(p.limits.birds)} birds · {limitText(p.limits.acres)} acres · {limitText(p.limits.users)} users
                      </p>
                      <div className="mt-2">
                        {p.quoteOnly ? (
                          <span className="text-sm">Call ZARODA on 0781 230 805</span>
                        ) : (
                          <Btn type="button" busy={busy} disabled={!!pending || (price > 0 && !phone.trim())} onClick={() => void start("/farm/plan/pay", { planCode: p.code, cycle })}>
                            {price ? (current ? "Renew with M-Pesa" : "Pay with M-Pesa") : current ? "Your plan" : "Switch to free"}
                          </Btn>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-secondary-500">
                The farm now has {b.usage.head} head, {b.usage.birds.toLocaleString("en-KE")} birds, {b.usage.acres} acres and {b.usage.users} users with a farm role; a smaller plan must fit them. Paying early adds the new period on to the end of the current one.
              </p>
            </Card>

            <Card title={`SMS credits: ${b.smsCredits} texts left`}>
              <p className="mb-2 text-xs text-secondary-500">Payslips and reminders use one text each (long ones use two). When credits run out, texting stops until you top up.</p>
              <div className="space-y-2">
                {b.smsBundles.map((s) => (
                  <div key={s.code} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {s.sms.toLocaleString("en-KE")} texts · {kes(s.price)}
                    </span>
                    <Btn type="button" tone="navy" busy={busy} disabled={!!pending || !phone.trim()} onClick={() => void start("/farm/plan/sms", { bundleCode: s.code })}>
                      Buy
                    </Btn>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="ZARODA fees">
              <p className="text-sm">
                This month: {b.feesThisMonth.count} M-Pesa wage payout{b.feesThisMonth.count === 1 ? "" : "s"} · <b>{kes(b.feesThisMonth.total)}</b>
              </p>
              <p className="text-xs text-secondary-500">
                Billed at the start of next month. Per payout: {b.payoutBands.map((x) => `${x.upTo === null ? "above" : `up to ${x.upTo.toLocaleString("en-KE")}`} KES ${x.fee}`).join(", ")}.
              </p>
              {b.invoices.length > 0 && (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {b.invoices.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        {i.periodMonth} · {kes(i.total)}
                      </span>
                      {i.status === "PAID" ? (
                        <span className="text-xs font-semibold" style={{ color: SHAMBA_INK }}>Paid</span>
                      ) : (
                        <Btn type="button" busy={busy} disabled={!!pending || !phone.trim()} onClick={() => void start(`/farm/plan/fees/${i.id}/pay`, {})}>
                          Pay with M-Pesa
                        </Btn>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {b.payments.length > 0 && (
              <Card title="Payments">
                <ul className="divide-y divide-border text-sm">
                  {b.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {kes(p.amount)} · {PURPOSE[p.purpose]}
                        {p.purpose === "PLAN" ? ` ${p.planCode.replace("FARM_", "").toLowerCase()} (${p.cycle.toLowerCase()})` : ""}
                        <span className="block text-xs text-secondary-500">
                          {(p.paidAt ?? p.createdAt).slice(0, 10)} · {p.method ?? "M-Pesa"}
                          {p.receipt ? ` · ${p.receipt}` : ""}
                          {p.error ? ` · ${p.error}` : ""}
                        </span>
                      </span>
                      <span className="text-xs font-semibold" style={{ color: p.status === "PAID" ? SHAMBA_BRAND.navy : p.status === "FAILED" ? "#b91c1c" : SHAMBA_BRAND.orange }}>
                        {p.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )
      }
    </ShambaAppFrame>
  );
}
