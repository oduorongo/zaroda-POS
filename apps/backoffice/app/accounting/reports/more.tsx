"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../../../lib/api";
import { API, downloadCsv, inputClass, kes, niceDay, quietButtonClass, todayKey } from "../shared";

interface Row {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}
interface CashFlow {
  from: string;
  to: string;
  opening: number;
  operating: { rows: Row[]; total: number };
  investing: { rows: Row[]; total: number };
  financing: { rows: Row[]; total: number };
  net: number;
  closing: number;
  reconciles: boolean;
}
type Amounts = { notDue: number; days1to30: number; days31to60: number; days61to90: number; days90plus: number; retention: number; total: number };
interface Aged {
  asOf: string;
  rows: (Amounts & { party: string; documents: number })[];
  totals: Amounts;
  documents: { party: string; kind: string; reference: string; date: string; dueDate: string | null; owed: number; daysLate: number | null }[];
  books: { account: string; balance: number }[];
  booksTotal: number;
}
interface Vat {
  month: string;
  from: string;
  to: string;
  sales: { label: string; rate: number | null; net: number; vat: number }[];
  salesNet: number;
  salesVat: number;
  refunds: { count: number; gross: number; vat: number };
  otherOutputVat: number;
  outputVat: number;
  purchases: {
    bills: { count: number; net: number; vat: number };
    expenses: { count: number; net: number; vat: number };
    checkedWithKra: number;
    schedule: { kind: string; pin: string | null; name: string | null; date: string; invoiceNo: string | null; reference: string; net: number; vat: number; checked: boolean }[];
    notClaimable: { count: number; vat: number; documents: { kind: string; date: string; reference: string; name: string | null; vat: number }[] };
    kraNotEntered: { id: string; pin: string; name: string | null; invoiceNo: string; date: string; total: number; vat: number }[];
  };
  salesNotSent: number | null;
  otherInputVat: number;
  inputVat: number;
  withholdingVat: { total: number; certificates: { date: string; reference: string; certificateNo: string | null; amount: number }[] };
  payable: number;
  creditCarriedForward: number;
}

const COLUMNS: [keyof Amounts, string][] = [
  ["notDue", "Not yet due"],
  ["days1to30", "1-30 days late"],
  ["days31to60", "31-60"],
  ["days61to90", "61-90"],
  ["days90plus", "Over 90"],
  ["retention", "Retention held"],
  ["total", "Total"],
];
const BOOK_NAMES: Record<string, string> = { AR: "Customers who owe us", RENT_AR: "Rent owed by tenants", RETENTION_RECEIVABLE: "Retention held by clients", AP: "Suppliers we owe", RETENTION_PAYABLE: "Retention held from subcontractors" };

const cell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(cell).join(",")).join("\n");

function useReport<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the report."));
  }, [path]);
  return { data, error };
}

const Err = ({ message }: { message: string | null }) => (message ? <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{message}</p> : null);

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-border pt-1 font-semibold" : "pl-3"}`}>
      <span>{label}</span>
      <span className={`font-mono ${value < 0 ? "text-red-600" : ""}`}>{kes(value)}</span>
    </div>
  );
}

/** Opening cash, money in and out by activity, closing cash. */
export function CashFlowReport({ from, to }: { from: string; to: string }) {
  const { data: cf, error } = useReport<CashFlow>(`${API}/reports/cash-flow?from=${from}&to=${to}`);
  if (!cf) return <Err message={error} />;
  const parts: [string, CashFlow["operating"]][] = [
    ["Trading (operating)", cf.operating],
    ["Buying and selling long-term assets (investing)", cf.investing],
    ["Owner's money and loans (financing)", cf.financing],
  ];
  function download() {
    const rows: (string | number)[][] = [["Cash flow statement", `${cf!.from} to ${cf!.to}`], [], ["", "Cash at the start", cf!.opening]];
    for (const [title, p] of parts) {
      rows.push([title]);
      for (const r of p.rows) rows.push([r.code, r.name, r.amount]);
      rows.push(["", `Net cash from ${title.split(" (")[0].toLowerCase()}`, p.total]);
    }
    rows.push(["", "Net change in cash", cf!.net], ["", "Cash at the end", cf!.closing]);
    downloadCsv(`cash-flow-${cf!.from}-${cf!.to}.csv`, csv(rows));
  }
  return (
    <div className="space-y-1 rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-secondary-500">
          {niceDay(cf.from)} to {niceDay(cf.to)} · cash, M-Pesa, bank and card payments on their way. Positive is money in.
        </p>
        <button onClick={download} className={quietButtonClass}>Download (CSV)</button>
      </div>
      <Line label="Cash at the start" value={cf.opening} strong />
      {parts.map(([title, p]) => (
        <div key={title} className="pt-2">
          <h2 className="font-semibold">{title}</h2>
          {p.rows.length === 0 && <p className="pl-3 text-xs text-secondary-500">Nothing</p>}
          {p.rows.map((r) => <Line key={r.accountId} label={`${r.code} ${r.name}`} value={r.amount} />)}
          <Line label={`Net cash from ${title.split(" (")[0].toLowerCase()}`} value={p.total} strong />
        </div>
      ))}
      <div className="pt-2" />
      <Line label="Net change in cash" value={cf.net} strong />
      <Line label="Cash at the end" value={cf.closing} strong />
      <p className={`pt-2 text-xs ${cf.reconciles ? "text-green-700" : "text-red-600"}`}>
        {cf.reconciles ? "It reconciles: cash at the start plus the change equals cash at the end." : "It does not reconcile. Please tell support."}
      </p>
    </div>
  );
}

/** Aged debtors (who owes us) or creditors (who we owe), by how late. */
export function AgedReport({ kind }: { kind: "debtors" | "creditors" }) {
  const { data: a, error } = useReport<Aged>(`${API}/reports/${kind}`);
  const [open, setOpen] = useState<string | null>(null);
  if (!a) return <Err message={error} />;
  const title = kind === "debtors" ? "Aged debtors" : "Aged creditors";
  const gap = Math.round((a.booksTotal - a.totals.total) * 100) / 100;
  function download() {
    const rows: (string | number)[][] = [[title, a!.asOf], [], [kind === "debtors" ? "Customer" : "Supplier", ...COLUMNS.map(([, l]) => l)]];
    for (const r of a!.rows) rows.push([r.party, ...COLUMNS.map(([k]) => r[k])]);
    rows.push(["Total", ...COLUMNS.map(([k]) => a!.totals[k])], [], ["Party", "Type", "Reference", "Date", "Due", "Days late", "Owed"]);
    for (const d of a!.documents) rows.push([d.party, d.kind, d.reference, d.date, d.dueDate ?? "on release", d.daysLate ?? "", d.owed]);
    downloadCsv(`${kind}-${a!.asOf}.csv`, csv(rows));
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-secondary-500">
          On {niceDay(a.asOf)}, by days past the due date.{" "}
          {kind === "debtors" ? "School invoices, construction IPCs (due 30 days after certification) and rent." : "Supplier bills and approved subcontractor valuations (due 30 days after approval)."} Tap a name for its documents.
        </p>
        <button onClick={download} className={quietButtonClass}>Download (CSV)</button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="border-b border-border text-left text-xs text-secondary-500">
            <tr>
              <th className="p-2">{kind === "debtors" ? "Customer" : "Supplier"}</th>
              {COLUMNS.map(([k, l]) => <th key={k} className="p-2 text-right">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {a.rows.length === 0 && (
              <tr><td className="p-2 text-secondary-500" colSpan={8}>Nothing is owed.</td></tr>
            )}
            {a.rows.map((r) => (
              <tr key={r.party} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary-500/10" onClick={() => setOpen(open === r.party ? null : r.party)}>
                <td className="p-2">{r.party} <span className="text-xs text-secondary-500">({r.documents})</span></td>
                {COLUMNS.map(([k]) => <td key={k} className={`p-2 text-right font-mono ${k === "total" ? "font-semibold" : ""} ${k === "days90plus" && r[k] > 0 ? "text-red-600" : ""}`}>{r[k] ? kes(r[k]) : ""}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border font-semibold">
            <tr>
              <td className="p-2">Total</td>
              {COLUMNS.map(([k]) => <td key={k} className="p-2 text-right font-mono">{kes(a.totals[k])}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      {open && (
        <div className="rounded-lg border border-border bg-surface p-3 text-sm">
          <h2 className="mb-1 font-semibold">{open}</h2>
          {a.documents.filter((d) => d.party === open).map((d) => (
            <div key={`${d.kind}-${d.reference}`} className="flex flex-wrap justify-between gap-2 border-b border-border/60 py-1 last:border-0">
              <span>{d.kind} {d.reference} · {niceDay(d.date)} · {d.dueDate ? `due ${niceDay(d.dueDate)}${d.daysLate ? `, ${d.daysLate} days late` : ""}` : "held until released"}</span>
              <span className="font-mono">{kes(d.owed)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-border bg-surface p-3 text-sm">
        <h2 className="font-semibold">In the books</h2>
        {a.books.map((b) => <Line key={b.account} label={BOOK_NAMES[b.account] ?? b.account} value={b.balance} />)}
        <Line label="Total in the books" value={a.booksTotal} strong />
        <p className={`pt-1 text-xs ${gap === 0 ? "text-green-700" : "text-secondary-500"}`}>
          {gap === 0 ? "Matches the list above." : `Differs from the list by ${kes(gap)}: usually entries not yet posted (the books post every few minutes), opening balances, or hand-made journals.`}
        </p>
      </div>
    </div>
  );
}

/** The month's VAT: output on sales, input on purchases, withholding VAT certificates, and what to pay KRA. */
export function VatReport() {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const { data: v, error } = useReport<Vat>(`${API}/reports/vat-return?month=${month}`);
  function download() {
    if (!v) return;
    const rows: (string | number)[][] = [["VAT return", v.month], [], ["Sales", "Value excl. VAT", "VAT"]];
    for (const s of v.sales) rows.push([s.label, s.net, s.vat]);
    rows.push(["Refunds and credit notes", -(v.refunds.gross - v.refunds.vat), -v.refunds.vat], ["Other output VAT (rent, hotel, adjustments)", "", v.otherOutputVat], ["Output VAT", "", v.outputVat], []);
    rows.push(["Purchases", "Value excl. VAT", "VAT"], [`Supplier bills (${v.purchases.bills.count} with VAT)`, v.purchases.bills.net, v.purchases.bills.vat], [`Expenses (${v.purchases.expenses.count} with VAT)`, v.purchases.expenses.net, v.purchases.expenses.vat], ["Other input VAT (adjustments)", "", v.otherInputVat], ["Input VAT", "", v.inputVat], []);
    rows.push(["Withholding VAT certificates", "", v.withholdingVat.total]);
    for (const c of v.withholdingVat.certificates) rows.push([`  ${c.date} ${c.reference} ${c.certificateNo ?? ""}`, "", c.amount]);
    rows.push([], ["VAT to pay KRA", "", v.payable], ["Credit carried forward", "", v.creditCarriedForward]);
    downloadCsv(`vat-return-${v.month}.csv`, csv(rows));
  }
  function downloadSchedule() {
    if (!v) return;
    const rows: (string | number)[][] = [["Supplier PIN", "Supplier name", "Invoice date", "eTIMS invoice number", "Description", "Taxable value", "VAT", "Checked with KRA"]];
    for (const p of v.purchases.schedule) rows.push([p.pin ?? "", p.name ?? "", p.date, p.invoiceNo ?? "", `${p.kind}: ${p.reference}`, p.net, p.vat, p.checked ? "yes" : "no"]);
    downloadCsv(`vat-purchases-${v.month}.csv`, csv(rows));
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 text-sm">
        <label>
          Month
          <input type="month" max={todayKey().slice(0, 7)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={inputClass} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button onClick={download} className={quietButtonClass}>Download (CSV)</button>
          <button onClick={downloadSchedule} className={quietButtonClass}>Purchases list for iTax (CSV)</button>
        </div>
      </div>
      <Err message={error} />
      {v && v.salesNotSent !== null && v.salesNotSent > 0 && (
        <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">
          {v.salesNotSent} sale{v.salesNotSent === 1 ? " has" : "s have"} not been confirmed by KRA (eTIMS) yet. KRA compares the VAT return with what eTIMS holds: see Sales sent to KRA before filing.
        </p>
      )}
      {v && v.purchases.kraNotEntered.length > 0 && (
        <div className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">
          <p>
            KRA holds {v.purchases.kraNotEntered.length} supplier invoice{v.purchases.kraNotEntered.length === 1 ? "" : "s"} to you this month (VAT {kes(v.purchases.kraNotEntered.reduce((t, k) => t + k.vat, 0))}) not entered as a bill or expense, so that VAT is not claimed:
          </p>
          <ul className="list-disc pl-5">
            {v.purchases.kraNotEntered.map((k) => <li key={k.id}>{k.name ?? k.pin} invoice {k.invoiceNo}, {niceDay(k.date)}: {kes(k.total)} (VAT {kes(k.vat)})</li>)}
          </ul>
          <p>Record them, then link them on Settings, eTIMS, Purchases.</p>
        </div>
      )}
      {v && (
        <div className="space-y-1 rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="text-xs text-secondary-500">{niceDay(v.from)} to {niceDay(v.to)} · totals are the VAT accounts in the books; file the return on iTax by the 20th of the next month.</p>
          <h2 className="pt-2 font-semibold">Output VAT (on sales)</h2>
          <div className="flex justify-between gap-3 pl-3 text-xs text-secondary-500"><span>VAT class</span><span>Value excl. VAT · VAT</span></div>
          {v.sales.length === 0 && <p className="pl-3 text-xs text-secondary-500">No sales</p>}
          {v.sales.map((s) => (
            <div key={s.label} className="flex justify-between gap-3 pl-3">
              <span>{s.label}</span>
              <span className="font-mono">{kes(s.net)} · {kes(s.vat)}</span>
            </div>
          ))}
          {v.refunds.count > 0 && <Line label={`Refunds and credit notes (${v.refunds.count})`} value={-v.refunds.vat} />}
          {v.otherOutputVat !== 0 && <Line label="Other (rent, hotel, adjustments)" value={v.otherOutputVat} />}
          <Line label="Output VAT" value={v.outputVat} strong />
          <h2 className="pt-2 font-semibold">Input VAT (on purchases, claimable)</h2>
          <Line label={`Supplier bills (${v.purchases.bills.count} with VAT)`} value={v.purchases.bills.vat} />
          <Line label={`Expenses (${v.purchases.expenses.count} with VAT)`} value={v.purchases.expenses.vat} />
          {v.otherInputVat !== 0 && <Line label="Other (credit notes, adjustments)" value={v.otherInputVat} />}
          <Line label="Input VAT" value={v.inputVat} strong />
          <p className="pl-3 text-xs text-secondary-500">
            {kes(v.purchases.checkedWithKra)} of it is checked against KRA&apos;s eTIMS invoices; the rest was entered by hand with the supplier&apos;s PIN and invoice number: check those show on iTax before filing.
          </p>
          {v.purchases.schedule.length > 0 && (
            <details className="pl-3 text-xs">
              <summary className="cursor-pointer text-secondary-500">The purchases ({v.purchases.schedule.length})</summary>
              {v.purchases.schedule.map((p, i) => (
                <div key={i} className="flex justify-between gap-2 border-b border-border/60 py-1">
                  <span>{niceDay(p.date)} · {p.name ?? ""} {p.pin} · invoice {p.invoiceNo} {p.checked ? "· checked" : ""}</span>
                  <span className="font-mono">{kes(p.vat)}</span>
                </div>
              ))}
            </details>
          )}
          {v.purchases.notClaimable.count > 0 && (
            <div className="pl-3 text-xs text-amber-500">
              <p>Not claimable ({v.purchases.notClaimable.count}): VAT {kes(v.purchases.notClaimable.vat)} was entered without the supplier&apos;s KRA PIN or eTIMS invoice number, so it is counted as a cost. Add them on the bill or expense to claim it.</p>
              {v.purchases.notClaimable.documents.map((d, i) => <p key={i} className="pl-2">{niceDay(d.date)} {d.kind}: {d.reference}{d.name ? ` (${d.name})` : ""} · {kes(d.vat)}</p>)}
            </div>
          )}
          <h2 className="pt-2 font-semibold">Withholding VAT certificates received</h2>
          {v.withholdingVat.certificates.map((c) => <Line key={`${c.reference}-${c.certificateNo}`} label={`${niceDay(c.date)} ${c.reference}${c.certificateNo ? ` (${c.certificateNo})` : ""}`} value={c.amount} />)}
          <Line label="Withholding VAT" value={v.withholdingVat.total} strong />
          <div className="pt-2" />
          {v.creditCarriedForward > 0 ? <Line label="Credit carried forward to next month" value={v.creditCarriedForward} strong /> : <Line label="VAT to pay KRA" value={v.payable} strong />}
          <p className="pt-2 text-xs text-secondary-500">Input VAT counts only where it is backed by the supplier&apos;s eTIMS invoice (their KRA PIN and the invoice number, or a link to the invoice KRA holds). Record a payment to KRA under Accounts, Money owed.</p>
        </div>
      )}
    </div>
  );
}
