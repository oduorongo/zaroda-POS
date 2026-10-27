"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { API, AccountingTabs, inputClass, kes, niceDay, quietButtonClass, buttonClass, todayKey, useBooksSession, Shell } from "./shared";

interface Overview {
  startDate: string;
  lockDate: string | null;
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
  balanced: boolean;
}
interface ProfitLoss {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
}

/** ZARODA's own books at a glance: where they stand, when they were last posted, and their settings. */
export default function PlatformAccountingPage() {
  const session = useBooksSession();
  const [data, setData] = useState<Overview | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [pl, setPl] = useState<ProfitLoss | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [lockDate, setLockDate] = useState("");

  const load = useCallback(async () => {
    try {
      const o = await apiGet<Overview>(`${API}/overview`);
      setData(o);
      setStartDate(o.startDate);
      setLockDate(o.lockDate ?? "");
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

  return (
    <Shell session={session}>
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-xl font-bold">ZARODA&apos;s books</h1>
        <AccountingTabs />
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-600/10 p-3 text-sm text-green-700">{notice}</p>}

        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="What ZARODA has" value={bs ? kes(bs.totalAssets) : "..."} />
              <Tile label="Income this month" value={pl ? kes(pl.totalIncome) : "..."} />
              <Tile label="Profit this month" value={pl ? kes(pl.netProfit) : "..."} tone={pl && pl.netProfit < 0 ? "text-red-600" : "text-green-600"} />
            </div>
            {bs && !bs.balanced && <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-900">The balance sheet does not balance. This should never happen.</p>}

            <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
              <h2 className="font-semibold">How these books are kept</h2>
              <p className="text-secondary-600">
                These are ZARODA&apos;s own accounts, separate from every business&apos;s, and no business can see them. Subscription payments,
                commission and shopper convenience-fee invoices (and their payments), rental plan and rent collection invoices, house advert
                fees and sales-agent payouts are posted automatically every few minutes. A waived invoice is taken back out. Enter ZARODA&apos;s
                own costs (hosting, SMS, salaries, marketing), owners&apos; money, loans and tax payments as journals.
              </p>
              <ul className="space-y-1">
                <li>
                  Posting from <strong>{niceDay(data.startDate)}</strong> ({data.entries.toLocaleString()} entries so far)
                </li>
                <li>Last posted: {data.lastPassAt ? new Date(data.lastPassAt).toLocaleString("en-KE") : "not yet"}</li>
                <li>{data.lockDate ? <>Closed up to <strong>{niceDay(data.lockDate)}</strong>.</> : "No period is closed."}</li>
              </ul>
              {data.lastPassNote && <p className="rounded-md bg-warning-50 p-2 text-xs text-warning-900">Something could not be posted: {data.lastPassNote}</p>}
              <button onClick={() => void postNow()} disabled={busy} className={buttonClass}>
                {busy ? "Posting..." : "Post now"}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/accounting/reports" className="rounded-lg border border-border bg-surface p-4 text-sm hover:bg-secondary-500/10">
                <strong>Statements</strong>
                <span className="block text-secondary-600">Trial balance, profit and loss, balance sheet.</span>
              </Link>
              <Link href="/accounting/journals" className="rounded-lg border border-border bg-surface p-4 text-sm hover:bg-secondary-500/10">
                <strong>Journals</strong>
                <span className="block text-secondary-600">Every entry, and ZARODA&apos;s own costs and corrections.</span>
              </Link>
            </div>

            <div className="space-y-4 rounded-lg border border-border bg-surface p-4 text-sm">
              <h2 className="font-semibold">Settings</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block">
                    Post automatically from
                    <input type="date" max={todayKey()} value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
                  </label>
                  <p className="mt-1 text-xs text-secondary-500">Move it back to bring earlier invoices and payments in. Once posted, it can only move earlier.</p>
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
                    Close the books up to
                    <input type="date" max={todayKey()} value={lockDate} onChange={(e) => setLockDate(e.target.value)} className={inputClass} />
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button disabled={busy || !lockDate || lockDate === data.lockDate} onClick={() => void save({ lockDate }, `The books are closed up to ${niceDay(lockDate)}.`)} className={quietButtonClass}>
                      Close up to this day
                    </button>
                    {data.lockDate && (
                      <button disabled={busy} onClick={() => void save({ lockDate: null }, "The books are open again.")} className={quietButtonClass}>
                        Open them again
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </Shell>
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
