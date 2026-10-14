"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";

interface DueRow {
  leaseId: string;
  tenant: { id: string; name: string; phone: string | null };
  unit: { id: string; label: string; property: { id: string; name: string } };
  monthlyRent: number;
  dueDay: number;
  outstanding: number;
  overdue: number;
  credit: number;
  nextDue: string | null;
  lastPaidAt: string | null;
}

interface PaymentRow {
  id: string;
  receiptNumber: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  voided: boolean;
  tenant: { id: string; name: string };
  unit: string;
}

const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const smallButton = "rounded border border-border px-2 py-1 text-xs hover:bg-background disabled:opacity-50";
const money = (v: number) => v.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);
const METHOD_LABEL: Record<string, string> = { CASH: "Cash", BANK: "Bank", MPESA: "M-Pesa", TUMA: "M-Pesa (auto)", DARAJA: "M-Pesa (auto)", OTHER: "Other" };

/**
 * The money side of the Rentals screen: who owes what this month, recording a payment, adding a one-off
 * charge, and the payment history with printable receipts and statements.
 */
export function RentSection({ onChanged }: { onChanged: () => void }) {
  const [view, setView] = useState<"dues" | "payments">("dues");
  const [dues, setDues] = useState<DueRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; receiptId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<DueRow | null>(null);
  const [charging, setCharging] = useState<DueRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "MPESA", reference: "", paidAt: "", note: "" });
  const [chargeForm, setChargeForm] = useState({ description: "", amount: "" });

  async function load() {
    try {
      const [d, p] = await Promise.all([apiGet<DueRow[]>("/rental/dues"), apiGet<PaymentRow[]>("/rental/payments")]);
      setDues(d);
      setPayments(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load rent details.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function startPayment(row: DueRow) {
    setCharging(null);
    setPaying(row);
    setNotice(null);
    setPayForm({ amount: row.outstanding > 0 ? String(row.outstanding) : "", method: "MPESA", reference: "", paidAt: "", note: "" });
  }

  const submitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paying) return;
    void run(async () => {
      const receipt = await apiPost<{ id: string; receiptNumber: string; keptAsCredit: number }>("/rental/payments", {
        leaseId: paying.leaseId,
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined,
        paidAt: payForm.paidAt || undefined,
        note: payForm.note || undefined,
      });
      setNotice({
        text: `Recorded KES ${money(Number(payForm.amount))} from ${paying.tenant.name}. Receipt ${receipt.receiptNumber}.${receipt.keptAsCredit > 0 ? ` KES ${money(receipt.keptAsCredit)} is kept as credit for next time.` : ""}`,
        receiptId: receipt.id,
      });
      setPaying(null);
    });
  };

  const submitCharge = (e: React.FormEvent) => {
    e.preventDefault();
    if (!charging) return;
    void run(async () => {
      await apiPost("/rental/invoices", { leaseId: charging.leaseId, description: chargeForm.description, amount: Number(chargeForm.amount) });
      setNotice({ text: `Added "${chargeForm.description}" (KES ${money(Number(chargeForm.amount))}) to ${charging.tenant.name}.` });
      setCharging(null);
      setChargeForm({ description: "", amount: "" });
    });
  };

  function voidPayment(p: PaymentRow) {
    const reason = window.prompt(`Void receipt ${p.receiptNumber} (KES ${money(p.amount)} from ${p.tenant.name})?\nThe money stops counting as paid. Why is it being voided?`);
    if (!reason || reason.trim().length < 2) return;
    void run(async () => {
      await apiPost(`/rental/payments/${p.id}/void`, { reason: reason.trim() });
      setNotice({ text: `Receipt ${p.receiptNumber} was voided.` });
    });
  }

  const totalOutstanding = dues.reduce((s, r) => s + r.outstanding, 0);
  const totalOverdue = dues.reduce((s, r) => s + r.overdue, 0);
  const owing = dues.filter((r) => r.outstanding > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-secondary-500">Owed by tenants (KES)</p>
          <p className="text-lg font-bold">{money(totalOutstanding)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-secondary-500">Overdue (KES)</p>
          <p className={`text-lg font-bold ${totalOverdue > 0 ? "text-red-400" : ""}`}>{money(totalOverdue)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-secondary-500">Tenants owing</p>
          <p className="text-lg font-bold">
            {owing}
            <span className="text-xs font-normal text-secondary-500"> / {dues.length}</span>
          </p>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && (
        <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">
          {notice.text}{" "}
          {notice.receiptId && (
            <Link href={`/rentals/print/receipt/${notice.receiptId}`} target="_blank" className="underline">
              Print receipt
            </Link>
          )}
        </p>
      )}

      <div className="flex gap-2">
        {(["dues", "payments"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm ${view === v ? "bg-primary-600 text-white" : "border border-border bg-surface"}`}>
            {v === "dues" ? "Who owes what" : "Payment history"}
          </button>
        ))}
      </div>

      {paying && (
        <form onSubmit={submitPayment} className="grid gap-2 rounded-lg border-2 border-primary-600 bg-surface p-3 sm:grid-cols-4">
          <p className="text-sm font-semibold sm:col-span-4">
            Record a payment from {paying.tenant.name} - {paying.unit.property.name} {paying.unit.label}
            <span className="ml-2 font-normal text-secondary-500">owes KES {money(paying.outstanding)}</span>
          </p>
          <input className={input} type="number" min="0.01" step="0.01" required placeholder="Amount" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
          <select className={input} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
            <option value="MPESA">M-Pesa</option>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
            <option value="OTHER">Other</option>
          </select>
          <input className={input} placeholder="M-Pesa code / reference" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
          <input className={input} type="date" title="Date received (blank = today)" value={payForm.paidAt} onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })} />
          <input className={`${input} sm:col-span-2`} placeholder="Note (optional)" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
          <div className="flex gap-2 sm:col-span-2">
            <button className={button} disabled={busy}>Save payment</button>
            <button type="button" className={smallButton} onClick={() => setPaying(null)}>Cancel</button>
          </div>
        </form>
      )}

      {charging && (
        <form onSubmit={submitCharge} className="grid gap-2 rounded-lg border-2 border-amber-600 bg-surface p-3 sm:grid-cols-4">
          <p className="text-sm font-semibold sm:col-span-4">
            Add a one-off charge for {charging.tenant.name} (water, repairs, late fee...)
          </p>
          <input className={`${input} sm:col-span-2`} required placeholder="What is it for?" value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} />
          <input className={input} type="number" min="0.01" step="0.01" required placeholder="Amount" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} />
          <div className="flex gap-2">
            <button className={button} disabled={busy}>Add charge</button>
            <button type="button" className={smallButton} onClick={() => setCharging(null)}>Cancel</button>
          </div>
        </form>
      )}

      {view === "dues" && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-secondary-500">
              <tr>
                <th className="p-2">Tenant</th>
                <th className="p-2">Unit</th>
                <th className="p-2">Rent</th>
                <th className="p-2">Owes</th>
                <th className="p-2">Overdue</th>
                <th className="p-2">Last paid</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {dues.map((r) => (
                <tr key={r.leaseId} className="border-t border-border">
                  <td className="p-2 font-medium">
                    {r.tenant.name}
                    {r.tenant.phone && <span className="block text-xs font-normal text-secondary-500">{r.tenant.phone}</span>}
                  </td>
                  <td className="p-2">{r.unit.property.name} {r.unit.label}</td>
                  <td className="p-2">{money(r.monthlyRent)}</td>
                  <td className="p-2">
                    {r.outstanding > 0 ? money(r.outstanding) : <span className="text-green-400">Paid up</span>}
                    {r.credit > 0 && <span className="block text-xs text-green-400">credit {money(r.credit)}</span>}
                  </td>
                  <td className={`p-2 ${r.overdue > 0 ? "font-semibold text-red-400" : ""}`}>{r.overdue > 0 ? money(r.overdue) : "-"}</td>
                  <td className="p-2">{r.lastPaidAt ? day(r.lastPaidAt) : "-"}</td>
                  <td className="space-x-1 p-2 text-right whitespace-nowrap">
                    <button className={smallButton} disabled={busy} onClick={() => startPayment(r)}>Record payment</button>
                    <button className={smallButton} disabled={busy} onClick={() => { setPaying(null); setCharging(r); setNotice(null); }}>+ Charge</button>
                    <Link href={`/rentals/print/statement/${r.leaseId}`} target="_blank" className={`${smallButton} inline-block`}>Statement</Link>
                  </td>
                </tr>
              ))}
              {dues.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3 text-secondary-500">No active leases yet. Start a lease and its rent invoices appear here automatically.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === "payments" && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-secondary-500">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Tenant</th>
                <th className="p-2">Unit</th>
                <th className="p-2">Amount</th>
                <th className="p-2">How</th>
                <th className="p-2">Reference</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={`border-t border-border ${p.voided ? "text-secondary-500 line-through" : ""}`}>
                  <td className="p-2">{day(p.paidAt)}</td>
                  <td className="p-2 font-medium">{p.tenant.name}</td>
                  <td className="p-2">{p.unit}</td>
                  <td className="p-2">{money(p.amount)}</td>
                  <td className="p-2">{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="p-2">{p.reference ?? p.receiptNumber}</td>
                  <td className="space-x-1 p-2 text-right whitespace-nowrap">
                    <Link href={`/rentals/print/receipt/${p.id}`} target="_blank" className={`${smallButton} inline-block no-underline`}>Receipt</Link>
                    {!p.voided && (
                      <button className={smallButton} disabled={busy} onClick={() => voidPayment(p)}>Void</button>
                    )}
                    {p.voided && <span className="text-xs no-underline">voided</span>}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3 text-secondary-500">No payments recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
