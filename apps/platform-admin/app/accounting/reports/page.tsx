"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../../../lib/api";
import { API, downloadCsv, loadBranches, AccountingTabs, inputClass, kes, monthStart, niceDay, quietButtonClass, todayKey, useBooksSession, Shell } from "../shared";

interface Row {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}
interface TrialBalance {
  asOf: string;
  balanced: boolean;
  debit: number;
  credit: number;
  rows: { accountId: string; code: string; name: string; type: string; debit: number; credit: number }[];
}
interface ProfitLoss {
  from: string;
  to: string;
  income: Row[];
  totalIncome: number;
  costOfSales: Row[];
  totalCostOfSales: number;
  grossProfit: number;
  expenses: Row[];
  totalExpenses: number;
  netProfit: number;
}
interface BalanceSheet {
  asOf: string;
  assets: Row[];
  totalAssets: number;
  liabilities: Row[];
  totalLiabilities: number;
  equity: Row[];
  profitToDate: number;
  totalEquity: number;
  balanced: boolean;
}
interface Branch {
  id: string;
  name: string;
}

type Tab = "pl" | "bs" | "tb";

// a cell a spreadsheet could read as a formula is written as text
const cell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(cell).join(",")).join("\n");

/** The three standard statements, straight from the books. */
export default function StatementsPage() {
  const session = useBooksSession();
  const [tab, setTab] = useState<Tab>("pl");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayKey());
  const [asOf, setAsOf] = useState(todayKey());
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pl, setPl] = useState<ProfitLoss | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) void loadBranches().then(setBranches).catch(() => undefined);
  }, [session]);

  const load = useCallback(async () => {
    try {
      if (tab === "pl") {
        const q = new URLSearchParams({ from, to });
        if (branchId) q.set("branchId", branchId);
        setPl(await apiGet<ProfitLoss>(`${API}/reports/profit-loss?${q.toString()}`));
      } else if (tab === "bs") setBs(await apiGet<BalanceSheet>(`${API}/reports/balance-sheet?asOf=${asOf}`));
      else setTb(await apiGet<TrialBalance>(`${API}/reports/trial-balance?asOf=${asOf}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the statement.");
    }
  }, [tab, from, to, asOf, branchId]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  function download() {
    if (tab === "pl" && pl) {
      const rows: (string | number)[][] = [["Profit and loss", `${pl.from} to ${pl.to}`], [], ["Code", "Account", "Amount"]];
      const part = (title: string, list: Row[], total: number) => {
        rows.push([title]);
        for (const r of list) rows.push([r.code, r.name, r.amount]);
        rows.push(["", `Total ${title.toLowerCase()}`, total]);
      };
      part("Income", pl.income, pl.totalIncome);
      part("Cost of sales", pl.costOfSales, pl.totalCostOfSales);
      rows.push(["", "Gross profit", pl.grossProfit]);
      part("Expenses", pl.expenses, pl.totalExpenses);
      rows.push(["", "Net profit", pl.netProfit]);
      downloadCsv(`profit-and-loss-${pl.from}-${pl.to}.csv`, csv(rows));
    } else if (tab === "bs" && bs) {
      const rows: (string | number)[][] = [["Balance sheet", bs.asOf], [], ["Code", "Account", "Amount"]];
      for (const [title, list, total] of [["Assets", bs.assets, bs.totalAssets], ["Liabilities", bs.liabilities, bs.totalLiabilities]] as const) {
        rows.push([title]);
        for (const r of list) rows.push([r.code, r.name, r.amount]);
        rows.push(["", `Total ${title.toLowerCase()}`, total]);
      }
      rows.push(["Equity"]);
      for (const r of bs.equity) rows.push([r.code, r.name, r.amount]);
      rows.push(["", "Profit not yet moved to equity", bs.profitToDate], ["", "Total equity", bs.totalEquity]);
      downloadCsv(`balance-sheet-${bs.asOf}.csv`, csv(rows));
    } else if (tab === "tb" && tb) {
      downloadCsv(
        `trial-balance-${tb.asOf}.csv`,
        csv([["Trial balance", tb.asOf], [], ["Code", "Account", "Debit", "Credit"], ...tb.rows.map((r) => [r.code, r.name, r.debit, r.credit]), ["", "Total", tb.debit, tb.credit]]),
      );
    }
  }

  if (!session) return null;

  return (
    <Shell session={session}>
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-xl font-bold">Statements</h1>
        <AccountingTabs />

        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["pl", "Profit and loss"],
                ["bs", "Balance sheet"],
                ["tb", "Trial balance"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-full border px-3 py-1.5 text-sm ${tab === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            {tab === "pl" ? (
              <>
                <label>
                  From
                  <input type="date" max={todayKey()} value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
                </label>
                <label>
                  To
                  <input type="date" max={todayKey()} value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
                </label>
                {branches.length > 1 && (
                  <label>
                    Branch
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
                      <option value="">Whole business</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <label>
                On the day
                <input type="date" max={todayKey()} value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputClass} />
              </label>
            )}
            <button onClick={download} className={quietButtonClass}>
              Download (CSV)
            </button>
          </div>
        </div>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        {tab === "pl" && pl && (
          <div className="space-y-1 rounded-lg border border-border bg-surface p-4 text-sm">
            <p className="text-xs text-secondary-500">
              {niceDay(pl.from)} to {niceDay(pl.to)}
              {branchId ? " · one branch (costs recorded for the whole business are left out)" : ""}
            </p>
            <Section title="Income" rows={pl.income} total={pl.totalIncome} />
            <Section title="Cost of sales" rows={pl.costOfSales} total={pl.totalCostOfSales} />
            <Total label="Gross profit" value={pl.grossProfit} />
            <Section title="Expenses" rows={pl.expenses} total={pl.totalExpenses} />
            <Total label={pl.netProfit >= 0 ? "Net profit" : "Net loss"} value={pl.netProfit} big />
          </div>
        )}

        {tab === "bs" && bs && (
          <div className="space-y-1 rounded-lg border border-border bg-surface p-4 text-sm">
            <p className="text-xs text-secondary-500">On {niceDay(bs.asOf)}</p>
            <Section title="What the business has (assets)" rows={bs.assets} total={bs.totalAssets} />
            <Section title="What it owes (liabilities)" rows={bs.liabilities} total={bs.totalLiabilities} />
            <Section title="Owner's money (equity)" rows={bs.equity} />
            <Line label="Profit not yet moved to equity" value={bs.profitToDate} />
            <Total label="Total equity" value={bs.totalEquity} />
            <Total label="Liabilities + equity" value={bs.totalLiabilities + bs.totalEquity} big />
            <p className={`pt-2 text-xs ${bs.balanced ? "text-green-700" : "text-red-600"}`}>
              {bs.balanced ? "It balances: what the business has equals what it owes plus the owner's money." : "It does not balance. Please tell support."}
            </p>
          </div>
        )}

        {tab === "tb" && tb && (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="border-b border-border text-left text-xs text-secondary-500">
                <tr>
                  <th className="p-2">Code</th>
                  <th className="p-2">Account</th>
                  <th className="p-2 text-right">Debit</th>
                  <th className="p-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r) => (
                  <tr key={r.accountId} className="border-b border-border/60 last:border-0">
                    <td className="p-2 font-mono">{r.code}</td>
                    <td className="p-2">{r.name}</td>
                    <td className="p-2 text-right font-mono">{r.debit ? kes(r.debit) : ""}</td>
                    <td className="p-2 text-right font-mono">{r.credit ? kes(r.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-semibold">
                <tr>
                  <td className="p-2" colSpan={2}>
                    Total {tb.balanced ? "(balanced)" : "(NOT balanced - tell support)"}
                  </td>
                  <td className="p-2 text-right font-mono">{kes(tb.debit)}</td>
                  <td className="p-2 text-right font-mono">{kes(tb.credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-xs text-secondary-500">Amounts in KES. Click an account in the chart of accounts to see every entry on it.</p>
      </main>
    </Shell>
  );
}

function Section({ title, rows, total }: { title: string; rows: Row[]; total?: number }) {
  return (
    <div className="pt-2">
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 && <p className="text-xs text-secondary-500">Nothing</p>}
      {rows.map((r) => (
        <Line key={r.accountId} label={`${r.code} ${r.name}`} value={r.amount} />
      ))}
      {total !== undefined && <Total label={`Total ${title.split(" (")[0].toLowerCase()}`} value={total} />}
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 pl-3">
      <span>{label}</span>
      <span className="font-mono">{kes(value)}</span>
    </div>
  );
}

function Total({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 border-t border-border pt-1 font-semibold ${big ? "text-base" : ""}`}>
      <span>{label}</span>
      <span className={`font-mono ${value < 0 ? "text-red-600" : ""}`}>{kes(value)}</span>
    </div>
  );
}
