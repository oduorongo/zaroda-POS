"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

type Method = "CASH" | "MPESA" | "BANK" | "CHEQUE";
const METHODS: [Method, string][] = [
  ["CASH", "Cash"],
  ["MPESA", "M-Pesa"],
  ["BANK", "Bank transfer"],
  ["CHEQUE", "Cheque"],
];

interface Bill {
  id: string;
  billNumber: string;
  supplier: { id: string; name: string };
  billDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  balance: number;
  status: "OPEN" | "PARTLY_PAID" | "PAID" | "VOID";
  overdue: boolean;
  receipt: { id: string; receiptNumber: string } | null;
  payments: { id: string; amount: number; method: string; reference: string | null; paidAt: string }[];
}

interface Aging {
  asOf: string;
  rows: { supplierId: string; supplierName: string; notDue: number; days1to30: number; days31to60: number; days61plus: number; total: number; bills: number }[];
  totals: { notDue: number; days1to30: number; days31to60: number; days61plus: number; total: number; bills: number };
}

interface Supplier {
  id: string;
  name: string;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const explain = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** What the business owes its suppliers: who is owed what and how late, every bill, and recording payments. */
export default function SupplierBillsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [aging, setAging] = useState<Aging | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filter, setFilter] = useState<"unpaid" | "overdue" | "paid" | "all">("unpaid");
  const [supplierId, setSupplierId] = useState("");
  const [paying, setPaying] = useState<Bill | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (supplierId) q.set("supplierId", supplierId);
      if (filter === "overdue") q.set("overdue", "true");
      const [list, ag] = await Promise.all([apiGet<Bill[]>(`/supplier-bills?${q.toString()}`), apiGet<Aging>("/supplier-bills/aging")]);
      setBills(list.filter((b) => (filter === "unpaid" || filter === "overdue" ? b.status === "OPEN" || b.status === "PARTLY_PAID" : filter === "paid" ? b.status === "PAID" : true)));
      setAging(ag);
      setError(null);
    } catch (e) {
      setError(explain(e, "Could not load the bills."));
    }
  }, [filter, supplierId]);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    setSession(s);
    apiGet<Supplier[]>("/suppliers").then(setSuppliers).catch(() => setSuppliers([]));
  }, [router]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (!session) return null;
  const canWrite = session.role === "MANAGER" || session.role === "OWNER";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-5xl space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Supplier bills</h1>
          <div className="flex flex-wrap gap-2">
            <Link href="/goods-receipts" className={ghost}>Goods received</Link>
            <Link href="/suppliers" className={ghost}>Suppliers</Link>
            {canWrite && <button className={primary} onClick={() => setAdding(true)}>Add a bill</button>}
          </div>
        </div>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        {aging && (
          <section className="space-y-2">
            <h2 className="font-semibold">Owed to suppliers <span className="text-sm font-normal text-secondary-500">as of {aging.asOf}</span></h2>
            {aging.rows.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface p-3 text-sm text-secondary-500">You owe nobody anything.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface text-secondary-500">
                    <tr>
                      <th className="p-3">Supplier</th>
                      <th className="p-3 text-right">Not yet due</th>
                      <th className="p-3 text-right">1-30 days late</th>
                      <th className="p-3 text-right">31-60</th>
                      <th className="p-3 text-right">Over 60</th>
                      <th className="p-3 text-right">Total owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aging.rows.map((r) => (
                      <tr key={r.supplierId} className="cursor-pointer border-t border-border hover:bg-secondary-500/5" onClick={() => setSupplierId(r.supplierId)}>
                        <td className="p-3">{r.supplierName} <span className="text-xs text-secondary-500">({r.bills} bill{r.bills === 1 ? "" : "s"})</span></td>
                        <td className="p-3 text-right font-mono">{r.notDue ? kes(r.notDue) : ""}</td>
                        <td className="p-3 text-right font-mono">{r.days1to30 ? kes(r.days1to30) : ""}</td>
                        <td className="p-3 text-right font-mono text-amber-500">{r.days31to60 ? kes(r.days31to60) : ""}</td>
                        <td className="p-3 text-right font-mono text-red-400">{r.days61plus ? kes(r.days61plus) : ""}</td>
                        <td className="p-3 text-right font-mono font-semibold">{kes(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border bg-surface font-semibold">
                      <td className="p-3">Everyone</td>
                      <td className="p-3 text-right font-mono">{kes(aging.totals.notDue)}</td>
                      <td className="p-3 text-right font-mono">{kes(aging.totals.days1to30)}</td>
                      <td className="p-3 text-right font-mono">{kes(aging.totals.days31to60)}</td>
                      <td className="p-3 text-right font-mono">{kes(aging.totals.days61plus)}</td>
                      <td className="p-3 text-right font-mono">{kes(aging.totals.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {(["unpaid", "overdue", "paid", "all"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-md border px-3 py-1.5 text-sm ${f === filter ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
                {f === "unpaid" ? "Unpaid" : f === "overdue" ? "Overdue" : f === "paid" ? "Paid" : "All"}
              </button>
            ))}
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-md border border-border bg-surface p-2 text-sm">
              <option value="">All suppliers</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {bills.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-3 text-sm text-secondary-500">No bills here.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {bills.map((b) => (
                <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {b.supplier.name} <span className="font-mono text-xs text-secondary-500">{b.billNumber}</span>
                      {b.overdue && <span className="ml-2 rounded bg-red-950 px-1.5 py-0.5 text-xs text-red-300">overdue</span>}
                      {b.status === "VOID" && <span className="ml-2 rounded bg-secondary-500/20 px-1.5 py-0.5 text-xs">cancelled</span>}
                    </p>
                    <p className="text-xs text-secondary-500">
                      Billed {b.billDate} · due {b.dueDate}
                      {b.receipt && <> · <Link href={`/goods-receipts/${b.receipt.id}`} className="text-primary-400 hover:underline">{b.receipt.receiptNumber}</Link></>}
                    </p>
                    {b.payments.length > 0 && <p className="text-xs text-secondary-500">Paid: {b.payments.map((p) => `${kes(p.amount)} ${p.method.toLowerCase()}${p.reference ? ` ${p.reference}` : ""}`).join(" · ")}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm">{kes(b.total)}</p>
                    <p className={`font-mono text-sm font-bold ${b.balance > 0 ? "text-amber-500" : "text-green-500"}`}>{b.status === "VOID" ? "—" : b.balance > 0 ? `Owe ${kes(b.balance)}` : "Paid"}</p>
                    {canWrite && b.balance > 0 && b.status !== "VOID" && <button className={`${ghost} mt-2`} onClick={() => setPaying(b)}>Record a payment</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {paying && <PayModal bill={paying} onClose={() => setPaying(null)} onDone={(m) => { setPaying(null); setNotice(m); void load(); }} />}
        {adding && <AddBillModal suppliers={suppliers} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); setNotice(m); void load(); }} />}
      </main>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-6 w-full max-w-md space-y-3 rounded-xl border border-border bg-background p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-sm text-secondary-500 hover:text-foreground">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PayModal({ bill, onClose, onDone }: { bill: Bill; onClose: () => void; onDone: (message: string) => void }) {
  const [amount, setAmount] = useState(bill.balance.toFixed(2));
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/supplier-bills/${bill.id}/payments`, { amount: Number(amount), method, reference: reference.trim() || undefined });
      onDone(`Payment of ${kes(Number(amount))} to ${bill.supplier.name} recorded.`);
    } catch (e) {
      setError(explain(e, "Could not record the payment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Pay ${bill.supplier.name}`} onClose={onClose}>
      {error && <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{error}</p>}
      <p className="text-sm text-secondary-500">Bill {bill.billNumber}: {kes(bill.total)}, still owed {kes(bill.balance)}.</p>
      <label className="block text-sm">Amount paid (KES)<input type="number" min={0.01} step="0.01" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="block text-sm">How
        <select className={field} value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      {method !== "CASH" && <label className="block text-sm">{method === "MPESA" ? "M-Pesa code" : method === "CHEQUE" ? "Cheque number" : "Bank reference"}<input className={field} value={reference} onChange={(e) => setReference(e.target.value)} /></label>}
      <button className={primary} disabled={busy || !(Number(amount) > 0) || (method !== "CASH" && !reference.trim())} onClick={() => void save()}>{busy ? "Saving..." : "Record the payment"}</button>
    </Modal>
  );
}

function AddBillModal({ suppliers, onClose, onDone }: { suppliers: Supplier[]; onClose: () => void; onDone: (message: string) => void }) {
  const [f, setF] = useState({ supplierId: suppliers[0]?.id ?? "", billNumber: "", total: "", billDate: "", dueDate: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/supplier-bills", { supplierId: f.supplierId, billNumber: f.billNumber.trim(), total: Number(f.total), billDate: f.billDate || undefined, dueDate: f.dueDate || undefined, notes: f.notes.trim() || undefined });
      onDone("Bill added.");
    } catch (e) {
      setError(explain(e, "Could not add the bill."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a supplier bill" onClose={onClose}>
      {error && <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{error}</p>}
      <p className="text-xs text-secondary-500">For an invoice that did not come with a delivery you received here. A bill for received stock is made from the receiving screen.</p>
      <label className="block text-sm">Supplier
        <select className={field} value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </label>
      <label className="block text-sm">Supplier&apos;s invoice number<input className={field} value={f.billNumber} onChange={(e) => set("billNumber", e.target.value)} /></label>
      <label className="block text-sm">Amount (KES)<input type="number" min={0.01} step="0.01" className={field} value={f.total} onChange={(e) => set("total", e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Bill date <span className="text-secondary-500">(today)</span><input type="date" className={field} value={f.billDate} onChange={(e) => set("billDate", e.target.value)} /></label>
        <label className="block text-sm">Due <span className="text-secondary-500">(by terms)</span><input type="date" className={field} value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></label>
      </div>
      <button className={primary} disabled={busy || !f.supplierId || !f.billNumber.trim() || !(Number(f.total) > 0)} onClick={() => void save()}>{busy ? "Saving..." : "Add the bill"}</button>
    </Modal>
  );
}
