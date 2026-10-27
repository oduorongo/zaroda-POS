"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";

interface Branch {
  id: string;
  name: string;
}
interface Pay {
  code: string;
  name: string;
  amount: number;
}
interface Totals {
  sales: { count: number; total: number };
  creditNotes: { count: number; total: number };
  taxByRate: { letter: string; label: string; rate: number; sales: { taxable: number; tax: number }; credit: { taxable: number; tax: number } }[];
  itemsSold: number;
  discounts: number;
  paymentsSales: Pay[];
  paymentsCreditNotes: Pay[];
  copies: { sale: { count: number; amount: number }; credit: { count: number; amount: number } };
  training: { count: number; amount: number };
  proforma: { count: number; amount: number };
  openingDeposit: number;
  incompleteSales: number;
  manualCreditNotes: number;
}
interface DailyReport {
  type: "X" | "Z";
  number?: number;
  business: { name: string; pin: string | null };
  branch: { name: string };
  generatedAt: string;
  sinceLastZ?: { number: number; at: string } | null;
  fromAt?: string;
  toAt?: string;
  documents?: number;
  totals: Totals;
}
interface ZRow {
  id: string;
  number: number;
  toAt: string;
  createdByName: string | null;
  sales: { count: number; total: number };
  creditNotes: { count: number; total: number };
}
interface Plu {
  business: { name: string; pin: string | null };
  branch: { name: string };
  from: string;
  to: string;
  rows: { itemCd: string; name: string; unitPrice: number; tax: string; quantity: number; amount: number; remaining: number | null }[];
  totals: { quantity: number; amount: number };
}
interface Closing {
  business: { name: string; pin: string | null };
  branch: { name: string };
  date: string;
  rows: { variantId: string; sku: string; name: string; quantity: number }[];
}

type Tab = "x" | "z" | "plu" | "stock";
const m = (n: number) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const when = (iso: string) => new Date(iso).toLocaleString("en-KE");
const field = "rounded-md border border-border bg-surface p-2 text-sm";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between gap-4 ${strong ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </p>
  );
}

function Daily({ r }: { r: DailyReport }) {
  const t = r.totals;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm print:border-0">
      <div className="text-center">
        <p className="font-bold">{r.business.name}</p>
        {r.business.pin && <p>PIN: {r.business.pin}</p>}
        <p className="text-lg font-bold">{r.type === "Z" ? `Z REPORT No. ${r.number}` : "X REPORT"}</p>
        <p className="text-xs text-secondary-500">
          {r.branch.name} · {when(r.generatedAt)}
          {r.type === "X" && r.sinceLastZ ? ` · since Z ${r.sinceLastZ.number}` : ""}
          {r.type === "Z" && r.fromAt ? ` · from ${when(r.fromAt)} to ${when(r.toAt!)}` : ""}
        </p>
      </div>
      <div className="space-y-0.5">
        <Row label={`Sales (NS): ${t.sales.count} receipts, tax included`} value={m(t.sales.total)} strong />
        <Row label={`Credit notes (NC): ${t.creditNotes.count}`} value={m(t.creditNotes.total)} strong />
        <Row label="Items sold" value={String(t.itemsSold)} />
        <Row label="All discounts" value={m(t.discounts)} />
        <Row label="Opening deposit (till floats)" value={m(t.openingDeposit)} />
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-secondary-500">
            <th className="py-1">Rate</th>
            <th className="text-right">Sales taxable</th>
            <th className="text-right">Sales tax</th>
            <th className="text-right">Credit taxable</th>
            <th className="text-right">Credit tax</th>
          </tr>
        </thead>
        <tbody>
          {t.taxByRate.map((x) => (
            <tr key={x.letter} className="border-b border-border/60">
              <td className="py-1">{x.label}</td>
              <td className="text-right font-mono">{m(x.sales.taxable)}</td>
              <td className="text-right font-mono">{m(x.sales.tax)}</td>
              <td className="text-right font-mono">{m(x.credit.taxable)}</td>
              <td className="text-right font-mono">{m(x.credit.tax)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-semibold">Sales by how paid</p>
          {t.paymentsSales.length === 0 && <p className="text-secondary-500">None</p>}
          {t.paymentsSales.map((p) => <Row key={p.code} label={p.name} value={m(p.amount)} />)}
        </div>
        <div>
          <p className="font-semibold">Credit notes by how paid</p>
          {t.paymentsCreditNotes.length === 0 && <p className="text-secondary-500">None</p>}
          {t.paymentsCreditNotes.map((p) => <Row key={p.code} label={p.name} value={m(p.amount)} />)}
        </div>
      </div>
      <div className="space-y-0.5 border-t border-border pt-2">
        <Row label={`Receipt copies (CS): ${t.copies.sale.count}`} value={m(t.copies.sale.amount)} />
        <Row label={`Credit note copies (CC): ${t.copies.credit.count}`} value={m(t.copies.credit.amount)} />
        <Row label={`Training receipts (TS/TC): ${t.training.count}`} value={m(t.training.amount)} />
        <Row label={`Proforma receipts (PS): ${t.proforma.count}`} value={m(t.proforma.amount)} />
        <Row label="Incomplete sales (not yet accepted by KRA)" value={String(t.incompleteSales)} />
        <Row label="Refunds to be done by hand on the KRA portal" value={String(t.manualCreditNotes)} />
      </div>
    </div>
  );
}

/** The reports KRA's specification asks of a trader's system: X, Z, PLU (items sold) and closing stock. */
export default function EtimsReportsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [tab, setTab] = useState<Tab>("x");
  const [x, setX] = useState<DailyReport | null>(null);
  const [zs, setZs] = useState<ZRow[]>([]);
  const [z, setZ] = useState<DailyReport | null>(null);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [plu, setPlu] = useState<Plu | null>(null);
  const [date, setDate] = useState(today());
  const [stock, setStock] = useState<Closing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canClose = session?.role === "OWNER" || session?.role === "MANAGER";

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
    setSession(s);
    void apiGet<Branch[]>("/branches")
      .then((b) => {
        setBranches(b);
        if (b[0]) setBranchId(b[0].id);
      })
      .catch(() => undefined);
  }, [router]);

  const loadX = useCallback(async () => {
    if (!branchId) return;
    try {
      setX(await apiGet<DailyReport>(`/etims/reports/x?branchId=${branchId}`));
      setZs(await apiGet<ZRow[]>(`/etims/reports/z?branchId=${branchId}`).catch(() => []));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the report.");
    }
  }, [branchId]);
  useEffect(() => {
    void loadX();
    setZ(null);
  }, [loadX]);

  async function run<T>(fn: () => Promise<T>, then: (v: T) => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      then(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="print:hidden">
        <Nav session={session} />
        <PageHeader />
      </div>
      <main className="mx-auto max-w-4xl space-y-4 p-6 print:p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <h1 className="text-xl font-bold">KRA daily reports</h1>
          <Link href="/settings/etims" className="text-sm text-primary-600 hover:underline">Back to eTIMS</Link>
        </div>
        <p className="text-sm text-secondary-500 print:hidden">The X report shows everything KRA has signed since the last Z. The Z report closes it and is kept as the day&apos;s record. The PLU report lists every item sold; closing stock shows what was on hand on a date.</p>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300 print:hidden">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300 print:hidden">{notice}</p>}

        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {(
            [
              ["x", "X report"],
              ["z", "Z reports"],
              ["plu", "Items sold (PLU)"],
              ["stock", "Closing stock"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-full border px-3 py-1 text-sm ${tab === k ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>{label}</button>
          ))}
          <button onClick={() => window.print()} className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary-500/10">Print</button>
        </div>

        {tab === "x" && x && (
          <>
            <Daily r={x} />
            {canClose && (
              <p className="print:hidden">
                <button
                  disabled={busy || (x.documents ?? 0) === 0}
                  onClick={() => {
                    if (!window.confirm("Close the day with a Z report? What is in the X report is sealed into it, and the next X starts from nothing.")) return;
                    void run(() => apiPost<DailyReport>(`/etims/reports/z?branchId=${branchId}`, {}), (r) => {
                      setZ(r);
                      setTab("z");
                      setNotice(`Z report ${r.number} made.`);
                      void loadX();
                    });
                  }}
                  className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  Close the day (make a Z report)
                </button>
              </p>
            )}
          </>
        )}

        {tab === "z" && (
          <>
            {z && <Daily r={z} />}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm print:hidden">
              {zs.length === 0 && <li className="p-3 text-secondary-500">No Z report has been made for this branch yet.</li>}
              {zs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <strong>Z {r.number}</strong> <span className="text-xs text-secondary-500">{when(r.toAt)}{r.createdByName ? ` · ${r.createdByName}` : ""}</span>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="font-mono">{r.sales.count} sales {m(r.sales.total)}</span>
                    <button onClick={() => void run(() => apiGet<DailyReport>(`/etims/reports/z/${r.id}`), setZ)} className="text-primary-600 hover:underline">Open</button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "plu" && (
          <>
            <div className="flex flex-wrap items-end gap-3 print:hidden">
              <label className="text-sm">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} ml-2`} /></label>
              <label className="text-sm">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${field} ml-2`} /></label>
              <button disabled={busy || !branchId} onClick={() => void run(() => apiGet<Plu>(`/etims/reports/plu?branchId=${branchId}&from=${from}&to=${to}`), setPlu)} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">Show</button>
            </div>
            {plu && (
              <div className="rounded-lg border border-border bg-surface p-4 text-sm print:border-0">
                <div className="mb-2 text-center">
                  <p className="font-bold">{plu.business.name}{plu.business.pin ? ` · PIN ${plu.business.pin}` : ""}</p>
                  <p className="text-lg font-bold">PLU REPORT</p>
                  <p className="text-xs text-secondary-500">{plu.branch.name} · {plu.from} to {plu.to}</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-secondary-500">
                      <th className="py-1">Item</th><th>Code</th><th className="text-right">Unit price</th><th>Tax</th><th className="text-right">Qty sold</th><th className="text-right">Amount</th><th className="text-right">In stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plu.rows.map((r) => (
                      <tr key={r.itemCd} className="border-b border-border/60">
                        <td className="py-1">{r.name}</td><td className="font-mono">{r.itemCd}</td><td className="text-right font-mono">{m(r.unitPrice)}</td><td>{r.tax}</td><td className="text-right font-mono">{r.quantity}</td><td className="text-right font-mono">{m(r.amount)}</td><td className="text-right font-mono">{r.remaining ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold"><td className="py-1">Total</td><td /><td /><td /><td className="text-right font-mono">{plu.totals.quantity}</td><td className="text-right font-mono">{m(plu.totals.amount)}</td><td /></tr>
                  </tfoot>
                </table>
                {plu.rows.length === 0 && <p className="mt-2 text-secondary-500">Nothing signed by KRA in these dates.</p>}
              </div>
            )}
          </>
        )}

        {tab === "stock" && (
          <>
            <div className="flex flex-wrap items-end gap-3 print:hidden">
              <label className="text-sm">On<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} ml-2`} /></label>
              <button disabled={busy || !branchId} onClick={() => void run(() => apiGet<Closing>(`/etims/reports/closing-stock?branchId=${branchId}&date=${date}`), setStock)} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">Show</button>
            </div>
            {stock && (
              <div className="rounded-lg border border-border bg-surface p-4 text-sm print:border-0">
                <div className="mb-2 text-center">
                  <p className="font-bold">{stock.business.name}{stock.business.pin ? ` · PIN ${stock.business.pin}` : ""}</p>
                  <p className="text-lg font-bold">CLOSING STOCK</p>
                  <p className="text-xs text-secondary-500">{stock.branch.name} · end of {stock.date}</p>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border text-left text-secondary-500"><th className="py-1">Item</th><th>Code</th><th className="text-right">On hand</th></tr></thead>
                  <tbody>
                    {stock.rows.map((r) => (
                      <tr key={r.variantId} className="border-b border-border/60"><td className="py-1">{r.name}</td><td className="font-mono">{r.sku}</td><td className="text-right font-mono">{r.quantity}</td></tr>
                    ))}
                  </tbody>
                </table>
                {stock.rows.length === 0 && <p className="mt-2 text-secondary-500">No stock on hand on that date.</p>}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
