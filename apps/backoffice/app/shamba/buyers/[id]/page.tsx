"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../../lib/api";
import { Card, ShambaAppFrame } from "../../../../components/shamba/frame";
import { ErrorBox, errText } from "../../../../components/shamba/livestock";
import { BUYER_KINDS, SHAMBA_BRAND, day, inputClass } from "../../../../lib/shamba";

interface Statement {
  buyer: { id: string; name: string; kind: string; phone: string | null; memberNo: string | null; kraPin: string | null; creditLimit: number | null; termsDays: number | null };
  from: string;
  to: string;
  opening: number;
  closing: number;
  aging: { current: number; d31: number; d61: number; d90: number; owed: number; credit: number };
  deliveries: { id: string; date: string; session: string | null; product: string; unit: string; quantity: number; unitPrice: number; amount: number; slipNo: string | null; voidedAt: string | null; voidReason: string | null }[];
  payments: { id: string; date: string; amount: number; method: string; reference: string | null; voidedAt: string | null; voidReason: string | null }[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BuyerStatementPage() {
  const { id } = useParams<{ id: string }>();
  const [from, setFrom] = useState("");
  const [s, setS] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => apiGet<Statement>(`/farm/sales/buyers/${id}/statement${from ? `?from=${from}` : ""}`).then(setS).catch((err) => setError(errText(err, "Could not load the statement")));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, from]);

  async function voidPayment(pid: string) {
    const reason = window.prompt("Why void this payment? (it is kept, marked void, and the buyer owes it again)");
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiPost(`/farm/sales/payments/${pid}/void`, { reason });
      await load();
    } catch (err) {
      setError(errText(err, "Could not void it"));
    }
  }

  const rows = s
    ? [
        ...s.deliveries.map((d) => ({ id: d.id, date: day(d.date), text: `${d.quantity} ${d.unit} ${d.product}${d.session ? ` (${d.session})` : ""}${d.slipNo ? ` · slip ${d.slipNo}` : ""}`, debit: d.amount, credit: 0, voided: !!d.voidedAt, why: d.voidReason, payment: false })),
        ...s.payments.map((p) => ({ id: p.id, date: day(p.date), text: `Payment · ${p.method}${p.reference ? ` ${p.reference}` : ""}`, debit: 0, credit: p.amount, voided: !!p.voidedAt, why: p.voidReason, payment: true })),
      ].sort((a, b) => a.date.localeCompare(b.date) || (a.payment === b.payment ? 0 : a.payment ? 1 : -1))
    : [];
  let running = s?.opening ?? 0;

  return (
    <ShambaAppFrame>
      {(session) => {
        const manager = session.role === "OWNER" || session.role === "MANAGER";
        if (!s) return error ? <ErrorBox error={error} /> : <p className="text-sm text-secondary-500">Loading...</p>;
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
              <Link href="/shamba/buyers" className="text-sm underline">
                ← Buyers
              </Link>
              <div className="flex items-end gap-2 text-sm">
                <label>
                  From
                  <input type="date" className={inputClass} value={from || s.from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <button type="button" onClick={() => window.print()} className="rounded-lg px-4 py-2.5 font-semibold text-white" style={{ background: SHAMBA_BRAND.navy }}>
                  Print statement
                </button>
              </div>
            </div>
            <ErrorBox error={error} />
            <Card>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h1 className="text-xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Statement: {s.buyer.name}</h1>
                  <p className="text-sm text-secondary-600">
                    {BUYER_KINDS[s.buyer.kind] ?? s.buyer.kind}
                    {s.buyer.memberNo ? ` · our member no. ${s.buyer.memberNo}` : ""}
                    {s.buyer.kraPin ? ` · PIN ${s.buyer.kraPin}` : ""}
                    {s.buyer.phone ? ` · ${s.buyer.phone}` : ""}
                  </p>
                  <p className="text-sm text-secondary-600">
                    {day(s.from)} to {day(s.to)}
                    {s.buyer.termsDays ? ` · pays within ${s.buyer.termsDays} days` : ""}
                    {s.buyer.creditLimit !== null ? ` · limit ${kes(s.buyer.creditLimit)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-secondary-500">Owed now</p>
                  <p className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>{kes(s.closing)}</p>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary-500">
                      <th className="py-1">Date</th>
                      <th>Details</th>
                      <th className="text-right">Delivered</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Balance</th>
                      <th className="print:hidden" />
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-secondary-100">
                      <td className="py-1.5" colSpan={4}>
                        Brought forward
                      </td>
                      <td className="text-right">{kes(s.opening)}</td>
                      <td className="print:hidden" />
                    </tr>
                    {rows.map((r) => {
                      if (!r.voided) running += r.debit - r.credit;
                      return (
                        <tr key={r.id} className={`border-t border-secondary-100 ${r.voided ? "text-secondary-400 line-through print:hidden" : ""}`} title={r.why ?? undefined}>
                          <td className="py-1.5 whitespace-nowrap">{r.date}</td>
                          <td>{r.text}</td>
                          <td className="text-right">{r.debit ? kes(r.debit) : ""}</td>
                          <td className="text-right">{r.credit ? kes(r.credit) : ""}</td>
                          <td className="text-right">{r.voided ? "" : kes(running)}</td>
                          <td className="text-right print:hidden">
                            {r.payment && !r.voided && manager && (
                              <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void voidPayment(r.id)}>
                                Void
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                {[
                  ["0-30 days", s.aging.current],
                  ["31-60 days", s.aging.d31],
                  ["61-90 days", s.aging.d61],
                  ["Over 90 days", s.aging.d90],
                  ["Total owed", s.aging.owed],
                ].map(([t, v]) => (
                  <div key={t as string} className="rounded-lg border border-secondary-200 p-2">
                    <p className="text-xs text-secondary-500">{t}</p>
                    <p className="font-semibold">{kes(v as number)}</p>
                  </div>
                ))}
              </div>
              {s.aging.credit > 0 && <p className="mt-2 text-sm">Paid in advance: {kes(s.aging.credit)}</p>}
            </Card>
          </div>
        );
      }}
    </ShambaAppFrame>
  );
}
