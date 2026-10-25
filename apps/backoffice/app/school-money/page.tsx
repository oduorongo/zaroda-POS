"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface SchoolLite {
  id: string;
  name: string;
  owed: number;
  credit: number;
}
interface Invoice {
  id: string;
  invoiceNumber: string;
  status: "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";
  issueDate: string;
  dueDate: string;
  school: { id: string; name: string };
  total: number;
  amountPaid: number;
  creditAmount: number;
  creditNotes: { id: string; creditNumber: string; total: number }[];
  balance: number;
}
interface CreditLine {
  invoiceLineId: string;
  description: string;
  unitPrice: number;
  taxRate: number;
  invoiced: number;
  credited: number;
  available: number;
  canRestock: boolean;
}
interface CreditNote {
  id: string;
  creditNumber: string;
  issueDate: string;
  reasonText: string;
  school: { id: string; name: string };
  invoice: { id: string; invoiceNumber: string };
  total: number;
  restocked: boolean;
}
interface Branch {
  id: string;
  name: string;
}
const REASONS: [string, string][] = [
  ["RETURNED", "Goods returned"],
  ["DAMAGED", "Goods damaged"],
  ["SHORT_DELIVERY", "Short delivery"],
  ["PRICE_ERROR", "Price correction"],
  ["OTHER", "Other"],
];
interface Payment {
  id: string;
  receiptNumber: string;
  status: "RECEIVED" | "BOUNCED";
  school: { id: string; name: string };
  amount: number;
  method: string;
  reference: string | null;
  receivedOn: string;
  onAccount: number;
  bounceReason: string | null;
}
interface Receivables {
  rows: { schoolId: string; name: string; phone: string; owed: number; overdue: number; credit: number; openInvoices: number; ageing: { CURRENT: number; DAYS_1_30: number; DAYS_31_60: number; DAYS_61_90: number; OVER_90: number } | null }[];
  totals: { owed: number; overdue: number; credit: number };
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const METHODS: [string, string][] = [
  ["CHEQUE", "Cheque"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["MPESA", "M-Pesa"],
  ["CASH", "Cash"],
];
const INVOICE_LABEL: Record<Invoice["status"], string> = { ISSUED: "Unpaid", PARTIALLY_PAID: "Part paid", PAID: "Paid", VOID: "Cancelled" };
const INVOICE_TONE: Record<Invoice["status"], string> = { ISSUED: "bg-amber-900 text-amber-200", PARTIALLY_PAID: "bg-blue-900 text-blue-200", PAID: "bg-green-900 text-green-200", VOID: "bg-secondary-500/20 text-secondary-500" };

type Tab = "owing" | "invoices" | "payments" | "credits";

/** What schools owe, the invoices, and the money received (cheques, transfers) with its receipts. */
export default function SchoolMoneyPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("owing");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [schools, setSchools] = useState<SchoolLite[]>([]);
  const [receivables, setReceivables] = useState<Receivables | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [creditNotes, setCreditNotes] = useState<CreditNote[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Make a credit note
  const [creditFor, setCreditFor] = useState<{ invoice: Invoice; lines: CreditLine[]; remaining: number } | null>(null);
  const [creditQty, setCreditQty] = useState<Record<string, string>>({});
  const [creditReason, setCreditReason] = useState("RETURNED");
  const [creditNoteText, setCreditNoteText] = useState("");
  const [cameBack, setCameBack] = useState(true);
  const [creditBranch, setCreditBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Receive a payment
  const [showForm, setShowForm] = useState(false);
  const [schoolId, setSchoolId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CHEQUE");
  const [reference, setReference] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [receivedOn, setReceivedOn] = useState(today());

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const q = schoolFilter ? `?schoolId=${schoolFilter}` : "";
      const [list, rec, inv, pay, cns] = await Promise.all([
        apiGet<SchoolLite[]>("/school-supplier/schools"),
        apiGet<Receivables>("/school-supplier/receivables"),
        apiGet<Invoice[]>(`/school-supplier/invoices${q}`),
        apiGet<Payment[]>(`/school-supplier/payments${q}`),
        apiGet<CreditNote[]>(`/school-supplier/credit-notes${q}`),
      ]);
      setCreditNotes(cns);
      setSchools(list);
      setReceivables(rec);
      setInvoices(inv);
      setPayments(pay);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this.");
    }
  }, [schoolFilter]);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void apiGet<Branch[]>("/branches")
      .then((b) => {
        setBranches(b);
        setCreditBranch((cur) => cur || b[0]?.id || "");
      })
      .catch(() => undefined);
    const wanted = new URLSearchParams(window.location.search).get("school");
    if (wanted) {
      setSchoolFilter(wanted);
      setSchoolId(wanted);
      setTab("invoices");
    }
  }, [router]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function receive(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const paid = await apiPost<{ id: string; receiptNumber: string; onAccount: number }>("/school-supplier/payments", {
        schoolId,
        amount: Number(amount),
        method,
        reference: reference.trim() || undefined,
        bankName: bankName.trim() || undefined,
        chequeDate: chequeDate || undefined,
        receivedOn,
      });
      setNotice(`Receipt ${paid.receiptNumber} made.${paid.onAccount > 0 ? ` ${kes(paid.onAccount)} is more than they owed and is kept as credit.` : ""}`);
      setAmount("");
      setReference("");
      setBankName("");
      setChequeDate("");
      setShowForm(false);
      window.open(`/school-print/receipt/${paid.id}`, "_blank");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record that payment.");
    } finally {
      setBusy(false);
    }
  }

  async function bounce(p: Payment) {
    const why = window.prompt(`Why did ${kes(p.amount)} (${p.receiptNumber}) not clear? e.g. "Cheque returned - insufficient funds"`);
    if (!why || why.trim().length < 3) return;
    try {
      await apiPost(`/school-supplier/payments/${p.id}/bounce`, { reason: why.trim() });
      setNotice(`${p.receiptNumber} marked as not cleared. The invoices it paid are owing again.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not do that.");
    }
  }

  async function voidInvoice(i: Invoice) {
    const why = window.prompt(`Cancel invoice ${i.invoiceNumber}? Stock is not put back. Why?`);
    if (!why || why.trim().length < 3) return;
    try {
      await apiPost(`/school-supplier/invoices/${i.id}/void`, { reason: why.trim() });
      setNotice(`${i.invoiceNumber} cancelled.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel it.");
    }
  }

  async function openCredit(i: Invoice) {
    try {
      const r = await apiGet<{ lines: CreditLine[]; remaining: number }>(`/school-supplier/invoices/${i.id}/creditable`);
      setCreditFor({ invoice: i, lines: r.lines, remaining: r.remaining });
      setCreditQty({});
      setCreditReason("RETURNED");
      setCreditNoteText("");
      setCameBack(true);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open that invoice.");
    }
  }

  async function makeCredit() {
    if (!creditFor) return;
    const chosen = creditFor.lines.filter((l) => Number(creditQty[l.invoiceLineId] ?? 0) > 0);
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const made = await apiPost<{ id: string; creditNumber: string; total: number }>("/school-supplier/credit-notes", {
        invoiceId: creditFor.invoice.id,
        reason: creditReason,
        note: creditNoteText.trim() || undefined,
        branchId: cameBack ? creditBranch || undefined : undefined,
        lines: chosen.map((l) => ({
          invoiceLineId: l.invoiceLineId,
          quantity: Number(creditQty[l.invoiceLineId]),
          restock: cameBack && l.canRestock ? Number(creditQty[l.invoiceLineId]) : 0,
        })),
      });
      setNotice(`Credit note ${made.creditNumber} for ${kes(made.total)} made. The school has been told.`);
      setCreditFor(null);
      window.open(`/school-print/credit-note/${made.id}`, "_blank");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not make the credit note.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;
  const todayKey = today();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">School invoices &amp; payments</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/schools" className="text-primary-600 hover:underline">Schools</Link>
            <Link href="/school-orders" className="text-primary-600 hover:underline">School orders</Link>
          </div>
        </div>

        {receivables && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-secondary-500">Schools owe you</p>
              <p className="font-mono text-lg font-bold">{kes(receivables.totals.owed)}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-secondary-500">Of that, late</p>
              <p className="font-mono text-lg font-bold text-red-400">{kes(receivables.totals.overdue)}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-secondary-500">Paid in advance</p>
              <p className="font-mono text-lg font-bold text-green-400">{kes(receivables.totals.credit)}</p>
            </div>
          </div>
        )}

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        {canEdit && (
          <div>
            {!showForm ? (
              <button onClick={() => setShowForm(true)} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
                Receive a payment
              </button>
            ) : (
              <form onSubmit={receive} className="space-y-3 rounded-lg border border-border bg-surface p-4">
                <h2 className="font-semibold">Receive a payment</h2>
                <p className="text-xs text-secondary-500">It may be part of what they owe. It pays their oldest invoice first, and anything extra is kept as credit. A receipt is made for you to print.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    From which school?
                    <select required value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className={field}>
                      <option value="">Choose...</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (owes {kes(s.owed)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Amount (KES)
                    <input required type="number" inputMode="decimal" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
                  </label>
                  <label className="text-sm">
                    How did they pay?
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
                      {METHODS.map(([k, l]) => (
                        <option key={k} value={k}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    {method === "CHEQUE" ? "Cheque number" : method === "MPESA" ? "M-Pesa code" : "Reference"} {method !== "CHEQUE" && <span className="text-secondary-500">(optional)</span>}
                    <input required={method === "CHEQUE"} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} className={field} />
                  </label>
                  {(method === "CHEQUE" || method === "BANK_TRANSFER") && (
                    <label className="text-sm">
                      Bank <span className="text-secondary-500">(optional)</span>
                      <input maxLength={80} value={bankName} onChange={(e) => setBankName(e.target.value)} className={field} />
                    </label>
                  )}
                  {method === "CHEQUE" && (
                    <label className="text-sm">
                      Date on the cheque <span className="text-secondary-500">(optional)</span>
                      <input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} className={field} />
                    </label>
                  )}
                  <label className="text-sm">
                    Date received
                    <input type="date" max={today()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={field} />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={busy || !schoolId || !amount} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                    {busy ? "Saving..." : "Make receipt"}
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary-500/10">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {(
              [
                ["owing", "Who owes"],
                ["invoices", "Invoices"],
                ["payments", "Payments received"],
                ["credits", "Credit notes"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} className={`rounded-full border px-3 py-1 text-sm ${tab === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
                {label}
              </button>
            ))}
          </div>
          {tab !== "owing" && (
            <select value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)} className="rounded-md border border-border bg-surface p-1.5 text-sm">
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        {tab === "owing" && (
          <section>
            {receivables && receivables.rows.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No school owes you anything right now.</p>}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {receivables?.rows.map((r) => (
                <li key={r.schoolId} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-secondary-500">{r.openInvoices} unpaid {r.openInvoices === 1 ? "invoice" : "invoices"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-base font-bold">{kes(r.owed)}</p>
                      {r.overdue > 0 && <p className="text-xs text-red-400">{kes(r.overdue)} late</p>}
                      {r.credit > 0 && <p className="text-xs text-green-400">{kes(r.credit)} paid in advance</p>}
                    </div>
                  </div>
                  {r.ageing && r.overdue > 0 && (
                    <p className="text-xs text-secondary-500">
                      Late by: 1-30 days {kes(r.ageing.DAYS_1_30)} · 31-60 {kes(r.ageing.DAYS_31_60)} · 61-90 {kes(r.ageing.DAYS_61_90)} · over 90 {kes(r.ageing.OVER_90)}
                    </p>
                  )}
                  <p className="flex gap-4 text-xs">
                    <Link href={`/school-print/statement/${r.schoolId}`} target="_blank" className="text-primary-600 hover:underline">Statement</Link>
                    <button onClick={() => { setSchoolFilter(r.schoolId); setSchoolId(r.schoolId); setTab("invoices"); }} className="text-primary-600 hover:underline">See invoices</button>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "invoices" && (
          <section>
            {invoices && invoices.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No invoices yet. They are made when you deliver an order.</p>}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {invoices?.map((i) => (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {i.school.name} <span className="font-mono text-xs text-secondary-500">{i.invoiceNumber}</span>
                    </p>
                    <p className="text-xs text-secondary-500">
                      Issued {i.issueDate} · due {i.dueDate}
                      {i.status !== "PAID" && i.status !== "VOID" && i.dueDate < todayKey ? <span className="ml-1 text-red-400">late</span> : null}
                    </p>
                    <p className="mt-1 flex gap-4 text-xs">
                      <Link href={`/school-print/invoice/${i.id}`} target="_blank" className="text-primary-600 hover:underline">Print</Link>
                      {canEdit && i.status === "ISSUED" && i.creditAmount === 0 && <button onClick={() => void voidInvoice(i)} className="text-error-600 hover:underline">Cancel invoice</button>}
                      {canEdit && i.status !== "VOID" && <button onClick={() => void openCredit(i)} className="text-primary-600 hover:underline">Credit note</button>}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`rounded px-2 py-0.5 text-xs ${INVOICE_TONE[i.status]}`}>{INVOICE_LABEL[i.status]}</span>
                    <p className="mt-1 font-mono font-semibold">{kes(i.total)}</p>
                    {i.status !== "VOID" && (i.amountPaid > 0 || i.creditAmount > 0) && <p className="text-xs text-secondary-500">{i.amountPaid > 0 ? `paid ${kes(i.amountPaid)} · ` : ""}{i.creditAmount > 0 ? `credited ${kes(i.creditAmount)} · ` : ""}owes {kes(i.balance)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {creditFor && (
          <section className="space-y-3 rounded-lg border border-primary-600 bg-surface p-4 text-sm">
            <h2 className="font-semibold">Credit note on {creditFor.invoice.invoiceNumber} - {creditFor.invoice.school.name}</h2>
            <p className="text-xs text-secondary-500">Enter how many of each item to credit. It takes that off what the school owes. The invoice still stands at {kes(creditFor.remaining)}.</p>
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs uppercase text-secondary-500">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Invoiced</th>
                  <th className="py-1 text-right">Already credited</th>
                  <th className="py-1 text-right">Credit now</th>
                </tr>
              </thead>
              <tbody>
                {creditFor.lines.map((l) => (
                  <tr key={l.invoiceLineId} className="border-t border-border">
                    <td className="py-1">{l.description}</td>
                    <td className="py-1 text-right">{l.invoiced}</td>
                    <td className="py-1 text-right">{l.credited || "-"}</td>
                    <td className="py-1 text-right">
                      <input type="number" min={0} max={l.available} step="any" disabled={l.available <= 0} value={creditQty[l.invoiceLineId] ?? ""} onChange={(e) => setCreditQty((q) => ({ ...q, [l.invoiceLineId]: e.target.value }))} className="w-24 rounded-md border border-border bg-surface p-1 text-right" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Reason
                <select value={creditReason} onChange={(e) => setCreditReason(e.target.value)} className={field}>
                  {REASONS.map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </select>
              </label>
              <label>
                Note <span className="text-secondary-500">(optional)</span>
                <input maxLength={300} value={creditNoteText} onChange={(e) => setCreditNoteText(e.target.value)} className={field} />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={cameBack} onChange={(e) => setCameBack(e.target.checked)} />
              The goods came back to us - put them back in stock
            </label>
            {cameBack && branches.length > 1 && (
              <label className="block">
                Back into which branch?
                <select value={creditBranch} onChange={(e) => setCreditBranch(e.target.value)} className={field}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex gap-2">
              <button disabled={busy || !creditFor.lines.some((l) => Number(creditQty[l.invoiceLineId] ?? 0) > 0) || (cameBack && !creditBranch)} onClick={() => void makeCredit()} className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {busy ? "Saving..." : "Make credit note"}
              </button>
              <button onClick={() => setCreditFor(null)} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-500/10">Cancel</button>
            </div>
          </section>
        )}

        {tab === "credits" && (
          <section>
            {creditNotes && creditNotes.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No credit notes yet. To credit goods a school sent back, open Invoices and press &quot;Credit note&quot; on the invoice.</p>}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {creditNotes?.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {c.school.name} <span className="font-mono text-xs text-secondary-500">{c.creditNumber}</span>
                    </p>
                    <p className="text-xs text-secondary-500">
                      {c.issueDate} · against {c.invoice.invoiceNumber} · {c.reasonText}
                      {c.restocked ? " · goods back in stock" : ""}
                    </p>
                    <p className="mt-1 text-xs">
                      <Link href={`/school-print/credit-note/${c.id}`} target="_blank" className="text-primary-600 hover:underline">Print</Link>
                    </p>
                  </div>
                  <p className="font-mono font-semibold">{kes(c.total)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "payments" && (
          <section>
            {payments && payments.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No payments recorded yet.</p>}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {payments?.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {p.school.name} <span className="font-mono text-xs text-secondary-500">{p.receiptNumber}</span>
                    </p>
                    <p className="text-xs text-secondary-500">
                      {p.receivedOn} · {METHODS.find(([k]) => k === p.method)?.[1] ?? p.method}
                      {p.reference ? ` ${p.reference}` : ""}
                    </p>
                    {p.status === "BOUNCED" && <p className="text-xs text-red-400">Did not clear: {p.bounceReason}</p>}
                    <p className="mt-1 flex gap-4 text-xs">
                      <Link href={`/school-print/receipt/${p.id}`} target="_blank" className="text-primary-600 hover:underline">Print receipt</Link>
                      {canEdit && p.status === "RECEIVED" && <button onClick={() => void bounce(p)} className="text-error-600 hover:underline">Did not clear</button>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono font-semibold ${p.status === "BOUNCED" ? "text-secondary-500 line-through" : ""}`}>{kes(p.amount)}</p>
                    {p.status === "RECEIVED" && p.onAccount > 0 && <p className="text-xs text-green-400">{kes(p.onAccount)} kept as credit</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
