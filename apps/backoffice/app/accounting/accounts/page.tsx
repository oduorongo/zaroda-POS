"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { Nav } from "../../../components/nav";
import { PageHeader } from "../../../components/page-header";
import { Account, AccountingTabs, buttonClass, canWrite, inputClass, kes, monthStart, niceDay, quietButtonClass, todayKey, TYPE_LABELS, useBackofficeSession } from "../shared";

interface Ledger {
  account: { id: string; code: string; name: string; type: Account["type"] };
  from: string;
  to: string;
  opening: number;
  closing: number;
  lines: { entryId: string; number: number; date: string; memo: string; source: string | null; debit: number; credit: number; balance: number }[];
  truncated: boolean;
}

const TYPES = Object.keys(TYPE_LABELS) as Account["type"][];

/** The chart of accounts with each account's balance; open one to see every entry on it. */
export default function AccountsPage() {
  const session = useBackofficeSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("EXPENSE");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayKey());

  const load = useCallback(async () => {
    try {
      setAccounts(await apiGet<Account[]>("/accounting/accounts"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the accounts.");
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function openLedger(id: string, f = from, t = to) {
    try {
      setLedger(await apiGet<Ledger>(`/accounting/accounts/${id}/ledger?from=${f}&to=${t}`));
      setError(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the account.");
    }
  }

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Chart of accounts</h1>
          {writer && !adding && (
            <button onClick={() => setAdding(true)} className={buttonClass}>
              Add an account
            </button>
          )}
        </div>
        <AccountingTabs />
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-600/10 p-3 text-sm text-green-700">{notice}</p>}

        {adding && (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
            <h2 className="font-semibold">Add an account</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <label>
                Code
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 6110" className={inputClass} />
              </label>
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Security guards" className={inputClass} />
              </label>
              <label>
                Kind
                <select value={type} onChange={(e) => setType(e.target.value as Account["type"])} className={inputClass}>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-secondary-500">Codes: 1... what you have, 2... what you owe, 3... owner&apos;s money, 4... income, 5... cost of sales, 6... expenses.</p>
            <div className="flex gap-2">
              <button
                disabled={busy || !code || name.trim().length < 2}
                onClick={() =>
                  void run(async () => {
                    await apiPost("/accounting/accounts", { code, name, type });
                    setAdding(false);
                    setCode("");
                    setName("");
                  }, "The account is added.")
                }
                className={buttonClass}
              >
                Save
              </button>
              <button onClick={() => setAdding(false)} className={quietButtonClass}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {ledger && (
          <div className="space-y-3 rounded-lg border border-primary-600/40 bg-surface p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="font-semibold">
                {ledger.account.code} {ledger.account.name}
              </h2>
              <button onClick={() => setLedger(null)} className={quietButtonClass}>
                Close
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label>
                From
                <input type="date" max={todayKey()} value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
              </label>
              <label>
                To
                <input type="date" max={todayKey()} value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
              </label>
              <button onClick={() => void openLedger(ledger.account.id)} className={quietButtonClass}>
                Show
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem]">
                <thead className="border-b border-border text-left text-xs text-secondary-500">
                  <tr>
                    <th className="p-1">Date</th>
                    <th className="p-1">No.</th>
                    <th className="p-1">What</th>
                    <th className="p-1 text-right">Debit</th>
                    <th className="p-1 text-right">Credit</th>
                    <th className="p-1 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/60 text-secondary-600">
                    <td className="p-1" colSpan={5}>
                      Balance on {niceDay(ledger.from)} (start of day)
                    </td>
                    <td className="p-1 text-right font-mono">{kes(ledger.opening)}</td>
                  </tr>
                  {ledger.lines.map((l, i) => (
                    <tr key={`${l.entryId}-${i}`} className="border-b border-border/60 last:border-0">
                      <td className="p-1 whitespace-nowrap">{niceDay(l.date)}</td>
                      <td className="p-1 font-mono">{l.number}</td>
                      <td className="p-1">
                        {l.memo}
                        {l.source && <span className="block text-xs text-secondary-500">{l.source}</span>}
                      </td>
                      <td className="p-1 text-right font-mono">{l.debit ? kes(l.debit) : ""}</td>
                      <td className="p-1 text-right font-mono">{l.credit ? kes(l.credit) : ""}</td>
                      <td className="p-1 text-right font-mono">{kes(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="font-semibold">
                  <tr>
                    <td className="p-1" colSpan={5}>
                      Balance on {niceDay(ledger.to)}
                    </td>
                    <td className="p-1 text-right font-mono">{kes(ledger.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {ledger.truncated && <p className="text-xs text-warning-900">Only the first 2,000 lines are shown. Choose a shorter period.</p>}
          </div>
        )}

        {TYPES.map((t) => {
          const list = accounts.filter((a) => a.type === t);
          if (list.length === 0) return null;
          return (
            <div key={t} className="overflow-x-auto rounded-lg border border-border bg-surface">
              <h2 className="border-b border-border p-2 text-sm font-semibold">{TYPE_LABELS[t]}</h2>
              <table className="w-full min-w-[34rem] text-sm">
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className={`border-b border-border/60 last:border-0 ${a.active ? "" : "text-secondary-500"}`}>
                      <td className="w-20 p-2 font-mono">{a.code}</td>
                      <td className="p-2">
                        {editing === a.id ? (
                          <span className="flex gap-2">
                            <input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} className="flex-1 rounded-md border border-border bg-surface p-1" />
                            <button
                              disabled={busy || editName.trim().length < 2}
                              onClick={() =>
                                void run(async () => {
                                  await apiPatch(`/accounting/accounts/${a.id}`, { name: editName });
                                  setEditing(null);
                                }, "Renamed.")
                              }
                              className="text-xs text-primary-600"
                            >
                              Save
                            </button>
                            <button onClick={() => setEditing(null)} className="text-xs">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button onClick={() => void openLedger(a.id)} className="text-left hover:underline">
                            {a.name}
                            {!a.active && " (switched off)"}
                            {a.system && <span className="ml-2 text-xs text-secondary-500">posted to automatically</span>}
                          </button>
                        )}
                      </td>
                      <td className={`p-2 text-right font-mono ${a.balance < 0 ? "text-red-600" : ""}`}>{a.balance ? kes(a.balance) : "-"}</td>
                      {writer && (
                        <td className="w-40 p-2 text-right text-xs">
                          <button
                            onClick={() => {
                              setEditing(a.id);
                              setEditName(a.name);
                            }}
                            className="text-primary-600 hover:underline"
                          >
                            Rename
                          </button>
                          {!a.system && (
                            <button
                              disabled={busy}
                              onClick={() => void run(() => apiPatch(`/accounting/accounts/${a.id}`, { active: !a.active }), a.active ? "Switched off." : "Switched on.")}
                              className="ml-3 text-primary-600 hover:underline"
                            >
                              {a.active ? "Switch off" : "Switch on"}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        <p className="text-xs text-secondary-500">Balances are to today, each in its usual direction (a minus means the account is the other way round).</p>
      </main>
    </div>
  );
}
