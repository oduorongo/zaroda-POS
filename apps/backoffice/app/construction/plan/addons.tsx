"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import { CON_BRAND, errorText, kes } from "../../../lib/construction";
import { ErrorBox, Field, Panel, inputClass } from "../../../components/construction/ui";

interface Addons {
  smsCredits: number;
  bundles: { code: string; name: string; sms: number; price: number }[];
  extraProjects: { sold: boolean; owned: number; monthlyPrice: number; canBuy: boolean; oneSlotNow: number | null; limit: number | null; active: number };
  fees: {
    thisMonth: { month: string; count: number; total: number };
    invoices: { id: string; month: string; total: number; status: "UNPAID" | "PAID"; payouts: number; paidAt: string | null }[];
    bands: { upTo: number | null; fee: number }[];
  };
}

/** Extra project slots, SMS bundles and ZARODA's monthly fees, each paid by M-Pesa like the plan. */
export function AddonsPanel({ canPay, canPayOnline, renews, onPaid }: { canPay: boolean; canPayOnline: boolean; renews: string; onPaid: () => void }) {
  const [a, setA] = useState<Addons | null>(null);
  const [phone, setPhone] = useState("");
  const [slots, setSlots] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => apiGet<Addons>("/construction/plan/addons").then(setA).catch((e) => setError(errorText(e, "Could not load add-ons."))), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(path: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiPost<{ status?: string; error?: string | null }>(path, body);
      if (r.status === "FAILED") setError(r.error ?? "The M-Pesa prompt could not be sent.");
      else setNotice(done);
      await load();
      onPaid();
    } catch (e) {
      setError(errorText(e, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  if (!a) return <ErrorBox message={error} />;
  const ready = canPay && canPayOnline && phone.trim().length >= 9;
  const prompt = "Check your phone and enter your M-Pesa PIN.";
  const e = a.extraProjects;

  return (
    <Panel title="Add-ons">
      <ErrorBox message={error} />
      {notice && <p className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      {canPay && (
        <div className="mb-4 max-w-xs">
          <Field label="M-Pesa number for add-ons">
            <input className={inputClass} inputMode="tel" value={phone} placeholder="0712 345 678" onChange={(ev) => setPhone(ev.target.value)} />
          </Field>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <section>
          <h3 className="text-sm font-semibold" style={{ color: "var(--con-ink)" }}>Extra project slots</h3>
          {!e.sold ? (
            <p className="mt-1 text-sm text-secondary-600">Not sold on your plan - upgrade for more projects.</p>
          ) : (
            <>
              <p className="mt-1 text-sm">You have <strong>{e.owned}</strong> extra · {e.active} of {e.limit ?? "unlimited"} projects open.</p>
              <p className="text-xs text-secondary-500">{kes(e.monthlyPrice)} per slot a month. Today you pay only for the days to {new Date(renews).toLocaleDateString("en-KE")}; after that it renews with the plan.</p>
              {canPay && (e.canBuy ? (
                <div className="mt-2 flex items-end gap-2">
                  <input className={`${inputClass} w-20`} type="number" min={1} max={20} value={slots} onChange={(ev) => setSlots(Math.min(20, Math.max(1, Number(ev.target.value) || 1)))} />
                  <button type="button" disabled={busy || !ready} onClick={() => run("/construction/plan/extra-projects", { count: slots, phone }, prompt)} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: CON_BRAND.orange }}>
                    Buy for {kes((e.oneSlotNow ?? 0) * slots)}
                  </button>
                </div>
              ) : <p className="mt-2 text-xs text-secondary-500">Pay for the plan first; slots are added to a paid plan.</p>)}
              {canPay && e.owned > 0 && (
                <button type="button" disabled={busy} className="mt-2 text-xs underline" onClick={() => window.confirm("Give back one extra project slot? There is no refund.") && run("/construction/plan/extra-projects/remove", { count: 1 }, "One slot given back.")}>Give back a slot</button>
              )}
            </>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold" style={{ color: "var(--con-ink)" }}>SMS credit</h3>
          <p className="mt-1 text-sm"><strong style={{ color: a.smsCredits < 20 ? "#dc2626" : undefined }}>{a.smsCredits.toLocaleString("en-KE")}</strong> texts left</p>
          <p className="text-xs text-secondary-500">Payslips and expiry alerts use one text each (long messages use two). When it runs out, texting stops until you top up.</p>
          <ul className="mt-2 space-y-1">
            {a.bundles.map((b) => (
              <li key={b.code} className="flex items-center justify-between gap-2 text-sm">
                <span>{b.name} · {kes(b.price)}</span>
                {canPay && <button type="button" disabled={busy || !ready} className="rounded-md px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ background: CON_BRAND.navy }} onClick={() => run("/construction/plan/sms", { bundleCode: b.code, phone }, prompt)}>Buy</button>}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-semibold" style={{ color: "var(--con-ink)" }}>ZARODA fees</h3>
          <p className="mt-1 text-sm">This month: {a.fees.thisMonth.count} M-Pesa wage payout{a.fees.thisMonth.count === 1 ? "" : "s"} · {kes(a.fees.thisMonth.total)}</p>
          <p className="text-xs text-secondary-500">Billed at the start of next month. Per payout: {a.fees.bands.map((b) => `${b.upTo === null ? "above" : `up to ${b.upTo.toLocaleString("en-KE")}`} ${kes(b.fee)}`).join(", ")}.</p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {a.fees.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-1">
                <span>{i.month} · {kes(i.total)} <span className="text-xs text-secondary-500">({i.payouts} payouts)</span></span>
                {i.status === "PAID" ? <span className="text-xs font-semibold text-green-700">PAID</span> : canPay ? (
                  <button type="button" disabled={busy || !ready} className="rounded-md px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ background: CON_BRAND.orange }} onClick={() => run(`/construction/plan/fees/${i.id}/pay`, { phone }, prompt)}>Pay</button>
                ) : <span className="text-xs font-semibold" style={{ color: CON_BRAND.orange }}>UNPAID</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Panel>
  );
}
