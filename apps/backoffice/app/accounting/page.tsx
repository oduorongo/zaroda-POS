"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { API, AccountingTabs, buttonClass, canWrite, inputClass, kes, niceDay, quietButtonClass, todayKey, useBooksSession, Shell } from "./shared";

interface Overview {
  startDate: string;
  lockDate: string | null;
  payrollPaidFrom: string;
  lastPassAt: string | null;
  lastPassNote: string | null;
  entries: number;
  accounts: number;
}
interface PassResult {
  posted: number;
  reposted: number;
  reversed: number;
  failed: number;
}
interface BalanceSheet {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  profitToDate: number;
  balanced: boolean;
}
interface ProfitLoss {
  totalIncome: number;
  grossProfit: number;
  netProfit: number;
}

/** The books at a glance: where they stand, when they were last posted, and their settings. */
export default function AccountingPage() {
  const session = useBooksSession();
  const [data, setData] = useState<Overview | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [pl, setPl] = useState<ProfitLoss | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [lockDate, setLockDate] = useState("");
  const [payrollPaidFrom, setPayrollPaidFrom] = useState("BANK");

  const load = useCallback(async () => {
    try {
      const o = await apiGet<Overview>(`${API}/overview`);
      setData(o);
      setStartDate(o.startDate);
      setLockDate(o.lockDate ?? "");
      setPayrollPaidFrom(o.payrollPaidFrom);
      const [b, p] = await Promise.all([
        apiGet<BalanceSheet>(`${API}/reports/balance-sheet`),
        apiGet<ProfitLoss>(`${API}/reports/profit-loss?from=${todayKey().slice(0, 7)}-01&to=${todayKey()}`),
      ]);
      setBs(b);
      setPl(p);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the books.");
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function postNow() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await apiPost<PassResult>(`${API}/post-now`, {});
      const changed = r.posted + r.reposted + r.reversed;
      setNotice(
        changed === 0 && r.failed === 0
          ? "Everything is already posted."
          : `Posted ${r.posted} new, corrected ${r.reposted}, undid ${r.reversed}${r.failed ? `; ${r.failed} could not be posted (see the note below)` : ""}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setNotice(null);
    try {
      await apiPatch(`${API}/settings`, body);
      setNotice(done);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;
  const writer = canWrite(session);
  const owner = session.role === "OWNER";

  return (
    <Shell session={session}>
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-xl font-bold">Accounts (books)</h1>
        <AccountingTabs />
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-600/10 p-3 text-sm text-green-700">{notice}</p>}

        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="What you have (assets)" value={bs ? kes(bs.totalAssets) : "..."} />
              <Tile label="What you owe" value={bs ? kes(bs.totalLiabilities) : "..."} />
              <Tile label="Profit this month" value={pl ? kes(pl.netProfit) : "..."} tone={pl && pl.netProfit < 0 ? "text-red-600" : "text-green-600"} />
            </div>
            {bs && !bs.balanced && (
              <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-900">The balance sheet does not balance. Please tell support: this should never happen.</p>
            )}

            <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
              <h2 className="font-semibold">How the books are kept</h2>
              <p className="text-secondary-600">
                Every sale, refund, tip, expense, supplier bill and payment, payroll run, school receipt, rent charge and payment, deposit
                handed back, hotel guest payment, layaway, waste, stock count and ZARODA charge is posted to the books for you every few
                minutes, as double entries. Moving stock between your branches needs no entry: it is still your stock. You only enter
                journals for things the system cannot see: the balances you started with, money the owner puts in or takes out, loans,
                equipment, and corrections. Record paying KRA, NSSF, SHIF or handing tips to staff under &quot;What you owe&quot;.
              </p>
              <ul className="space-y-1">
                <li>
                  Posting from <strong>{niceDay(data.startDate)}</strong> ({data.entries.toLocaleString()} entries so far)
                </li>
                <li>Last posted: {data.lastPassAt ? new Date(data.lastPassAt).toLocaleString("en-KE") : "not yet"}</li>
                <li>{data.lockDate ? <>Closed up to <strong>{niceDay(data.lockDate)}</strong>: nothing can be posted on or before that day.</> : "No period is closed."}</li>
              </ul>
              {data.lastPassNote && <p className="rounded-md bg-warning-50 p-2 text-xs text-warning-900">Something could not be posted: {data.lastPassNote}</p>}
              {writer && (
                <button onClick={() => void postNow()} disabled={busy} className={buttonClass}>
                  {busy ? "Posting..." : "Post now"}
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/accounting/reports" className="rounded-lg border border-border bg-surface p-4 text-sm hover:bg-secondary-500/10">
                <strong>Statements</strong>
                <span className="block text-secondary-600">Trial balance, profit and loss, balance sheet.</span>
              </Link>
              <Link href="/accounting/journals" className="rounded-lg border border-border bg-surface p-4 text-sm hover:bg-secondary-500/10">
                <strong>Journals</strong>
                <span className="block text-secondary-600">Every entry, and your own (opening balances, owner&apos;s money, corrections).</span>
              </Link>
            </div>

            <OwedBox writer={writer} onPaid={(m) => { setNotice(m); void load(); }} onError={setError} />

            {writer && (
              <div className="space-y-4 rounded-lg border border-border bg-surface p-4 text-sm">
                <h2 className="font-semibold">Settings</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block">
                      Post automatically from
                      <input type="date" max={todayKey()} value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
                    </label>
                    <p className="mt-1 text-xs text-secondary-500">
                      Move it back to bring earlier sales and expenses into the books. Once posted, it can only move earlier. Enter what you
                      had and owed on this day as an opening-balances journal.
                    </p>
                    <button
                      disabled={busy || startDate === data.startDate}
                      onClick={() => void save({ startDate }, "The start day is saved. Press Post now to bring the earlier records in.")}
                      className={`${quietButtonClass} mt-2`}
                    >
                      Save start day
                    </button>
                  </div>
                  <div>
                    <label className="block">
                      Payroll is paid from
                      <select value={payrollPaidFrom} onChange={(e) => setPayrollPaidFrom(e.target.value)} className={inputClass}>
                        <option value="BANK">Bank</option>
                        <option value="MPESA">M-Pesa</option>
                        <option value="CASH">Cash</option>
                      </select>
                    </label>
                    <button
                      disabled={busy || payrollPaidFrom === data.payrollPaidFrom}
                      onClick={() => void save({ payrollPaidFrom }, "Saved. Payroll runs paid from now on use it.")}
                      className={`${quietButtonClass} mt-2`}
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  <label className="block max-w-xs">
                    Close the books up to (owner only)
                    <input type="date" max={todayKey()} value={lockDate} onChange={(e) => setLockDate(e.target.value)} className={inputClass} disabled={!owner} />
                  </label>
                  <p className="mt-1 text-xs text-secondary-500">
                    After a month is checked (for example when the VAT return is filed), close it so nothing changes it. A late change, such
                    as an expense entered for a closed day, is posted on the first open day instead.
                  </p>
                  {owner && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        disabled={busy || !lockDate || lockDate === data.lockDate}
                        onClick={() => void save({ lockDate }, `The books are closed up to ${niceDay(lockDate)}.`)}
                        className={quietButtonClass}
                      >
                        Close up to this day
                      </button>
                      {data.lockDate && (
                        <button disabled={busy} onClick={() => void save({ lockDate: null }, "The books are open again.")} className={quietButtonClass}>
                          Open them again
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </Shell>
  );
}

interface Owed {
  account: string;
  label: string;
  owed: number;
}

/** What the business owes KRA, NSSF, SHIF and its staff (tips), and a form to record paying it. */
function OwedBox({ writer, onPaid, onError }: { writer: boolean; onPaid: (message: string) => void; onError: (message: string) => void }) {
  const [owed, setOwed] = useState<Owed[]>([]);
  const [paying, setPaying] = useState<Owed | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayKey());
  const [paidFrom, setPaidFrom] = useState("BANK");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void apiGet<Owed[]>(`${API}/owed`).then(setOwed).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  async function pay() {
    if (!paying) return;
    setBusy(true);
    try {
      await apiPost(`${API}/pay-off`, { account: paying.account, amount: Number(amount), date, paidFrom, reference: reference.trim() || undefined });
      onPaid(`Recorded: ${paying.label}, KES ${kes(Number(amount))}.`);
      setPaying(null);
      setAmount("");
      setReference("");
      load();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
      <h2 className="font-semibold">What you owe</h2>
      <p className="text-xs text-secondary-500">
        Tax and deductions collected for KRA, NSSF and SHIF, and tips held for your staff. When you pay one, record it here so the books
        show it as paid.
      </p>
      <ul className="divide-y divide-border/60">
        {owed.map((o) => (
          <li key={o.account} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>{o.label}</span>
            <span className="flex items-center gap-3">
              <span className={`font-mono ${o.owed < 0 ? "text-secondary-500" : ""}`}>KES {kes(o.owed)}</span>
              {writer && (
                <button
                  onClick={() => {
                    setPaying(o);
                    setAmount(o.owed > 0 ? String(o.owed) : "");
                  }}
                  className="text-xs text-primary-600 hover:underline"
                >
                  Record a payment
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {paying && (
        <div className="space-y-2 rounded-md border border-primary-600/40 p-3">
          <p className="font-medium">Paid: {paying.label}</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <label>
              Amount (KES)
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
            </label>
            <label>
              Date paid
              <input type="date" max={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </label>
            <label>
              Paid from
              <select value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} className={inputClass}>
                <option value="BANK">Bank</option>
                <option value="MPESA">M-Pesa</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            <label>
              Slip or code (optional)
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className={inputClass} />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void pay()} disabled={busy || !(Number(amount) > 0)} className={buttonClass}>
              Save
            </button>
            <button onClick={() => setPaying(null)} className={quietButtonClass}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-secondary-500">{label}</p>
      <p className={`text-xl font-bold ${tone ?? ""}`}>KES {value}</p>
    </div>
  );
}
