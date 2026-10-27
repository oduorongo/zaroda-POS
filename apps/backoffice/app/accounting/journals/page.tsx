"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { Nav } from "../../../components/nav";
import { PageHeader } from "../../../components/page-header";
import { Account, AccountingTabs, buttonClass, canWrite, inputClass, kes, niceDay, quietButtonClass, todayKey, useBackofficeSession } from "../shared";

type Kind = "AUTO" | "MANUAL" | "OPENING" | "REVERSAL";
interface ListRow {
  id: string;
  number: number;
  date: string;
  kind: Kind;
  memo: string;
  source: string | null;
  amount: number;
  reversedBy: { id: string; number: number } | null;
  reverses: string | null;
}
interface List {
  total: number;
  page: number;
  pageSize: number;
  rows: ListRow[];
}
interface Detail {
  id: string;
  number: number;
  date: string;
  kind: Kind;
  memo: string;
  source: string | null;
  createdByName: string | null;
  createdAt: string;
  reversedBy: { id: string; number: number } | null;
  reverses: { id: string; number: number } | null;
  lines: { accountId: string; code: string; name: string; debit: number; credit: number; memo: string | null }[];
}
interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

const KIND_LABELS: Record<Kind, string> = { AUTO: "Automatic", MANUAL: "Journal", OPENING: "Opening balances", REVERSAL: "Reversal" };
const emptyLine = (): DraftLine => ({ accountId: "", debit: "", credit: "", memo: "" });
const toCents = (s: string) => Math.round((Number(s) || 0) * 100);

/** Every entry in the books, newest first, and the journals the business enters itself. */
export default function JournalsPage() {
  const session = useBackofficeSession();
  const [list, setList] = useState<List | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"" | Kind>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [date, setDate] = useState(todayKey());
  const [memo, setMemo] = useState("");
  const [opening, setOpening] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page) });
      if (kind) q.set("kind", kind);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      if (search.trim()) q.set("search", search.trim());
      setList(await apiGet<List>(`/accounting/journals?${q.toString()}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the journals.");
    }
  }, [page, kind, from, to, search]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);
  useEffect(() => {
    if (session) void apiGet<Account[]>("/accounting/accounts").then(setAccounts).catch(() => undefined);
  }, [session]);

  async function show(id: string) {
    try {
      setOpen(await apiGet<Detail>(`/accounting/journals/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the journal.");
    }
  }

  async function reverse(e: Detail) {
    const reason = window.prompt(`Reverse journal ${e.number}? Say why (optional):`);
    if (reason === null) return;
    setBusy(true);
    try {
      const r = await apiPost<Detail>(`/accounting/journals/${e.id}/reverse`, { reason: reason || undefined });
      setNotice(`Journal ${e.number} is reversed by journal ${r.number}.`);
      setOpen(r);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reverse it.");
    } finally {
      setBusy(false);
    }
  }

  const debit = lines.reduce((s, l) => s + toCents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + toCents(l.credit), 0);
  const balanced = debit > 0 && debit === credit;

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function create() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await apiPost<Detail>("/accounting/journals", {
        date,
        memo,
        kind: opening ? "OPENING" : "MANUAL",
        lines: lines
          .filter((l) => l.accountId && (toCents(l.debit) || toCents(l.credit)))
          .map((l) => ({ accountId: l.accountId, debit: toCents(l.debit) / 100, credit: toCents(l.credit) / 100, memo: l.memo || undefined })),
      });
      setNotice(`Journal ${r.number} is saved.`);
      setCreating(false);
      setMemo("");
      setLines([emptyLine(), emptyLine()]);
      setOpen(r);
      setPage(1);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the journal.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;
  const writer = canWrite(session);
  const usable = accounts.filter((a) => a.active);
  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Journals</h1>
          {writer && !creating && (
            <button onClick={() => setCreating(true)} className={buttonClass}>
              New journal
            </button>
          )}
        </div>
        <AccountingTabs />
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-600/10 p-3 text-sm text-green-700">{notice}</p>}

        {creating && (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
            <h2 className="font-semibold">New journal</h2>
            <p className="text-xs text-secondary-500">
              For what the system cannot see: what you had and owed when you started (opening balances), money the owner puts in or
              takes out, a loan, equipment bought, a correction. Each line is a debit or a credit; the two totals must be equal.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label>
                Date
                <input type="date" max={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </label>
              <label className="sm:col-span-2">
                What it is for
                <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} placeholder="e.g. Owner put money in the bank" className={inputClass} />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={opening} onChange={(e) => setOpening(e.target.checked)} />
              These are the opening balances the books start with
            </label>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem]">
                <thead className="text-left text-xs text-secondary-500">
                  <tr>
                    <th className="p-1">Account</th>
                    <th className="p-1 text-right">Debit</th>
                    <th className="p-1 text-right">Credit</th>
                    <th className="p-1">Note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="p-1">
                        <select value={l.accountId} onChange={(e) => setLine(i, { accountId: e.target.value })} className="w-full rounded-md border border-border bg-surface p-2">
                          <option value="">Choose an account</option>
                          {usable.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1">
                        <input inputMode="decimal" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className="w-28 rounded-md border border-border bg-surface p-2 text-right" />
                      </td>
                      <td className="p-1">
                        <input inputMode="decimal" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className="w-28 rounded-md border border-border bg-surface p-2 text-right" />
                      </td>
                      <td className="p-1">
                        <input value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} maxLength={200} className="w-full rounded-md border border-border bg-surface p-2" />
                      </td>
                      <td className="p-1">
                        {lines.length > 2 && (
                          <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-xs text-red-600" aria-label="Remove line">
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="font-semibold">
                  <tr>
                    <td className="p-1">
                      <button onClick={() => setLines((ls) => [...ls, emptyLine()])} className="text-xs text-primary-600 hover:underline">
                        + Add a line
                      </button>
                    </td>
                    <td className="p-1 text-right font-mono">{kes(debit / 100)}</td>
                    <td className="p-1 text-right font-mono">{kes(credit / 100)}</td>
                    <td className={`p-1 text-xs ${balanced ? "text-green-700" : "text-red-600"}`} colSpan={2}>
                      {balanced ? "Balanced" : debit === credit ? "Enter the amounts" : `Difference ${kes(Math.abs(debit - credit) / 100)}`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void create()} disabled={busy || !balanced || memo.trim().length < 3} className={buttonClass}>
                Save journal
              </button>
              <button onClick={() => setCreating(false)} className={quietButtonClass}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {open && (
          <div className="space-y-2 rounded-lg border border-primary-600/40 bg-surface p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">
                  Journal {open.number} · {niceDay(open.date)}
                </h2>
                <p className="text-secondary-600">{open.memo}</p>
                <p className="text-xs text-secondary-500">
                  {KIND_LABELS[open.kind]}
                  {open.source ? ` from: ${open.source}` : ""}
                  {open.createdByName ? ` · by ${open.createdByName}` : ""}
                  {open.reverses ? ` · reverses journal ${open.reverses.number}` : ""}
                  {open.reversedBy ? ` · reversed by journal ${open.reversedBy.number}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {writer && (open.kind === "MANUAL" || open.kind === "OPENING") && !open.reversedBy && (
                  <button onClick={() => void reverse(open)} disabled={busy} className={quietButtonClass}>
                    Reverse
                  </button>
                )}
                <button onClick={() => setOpen(null)} className={quietButtonClass}>
                  Close
                </button>
              </div>
            </div>
            <table className="w-full">
              <tbody>
                {open.lines.map((l, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className={`p-1 ${l.credit > 0 ? "pl-6" : ""}`}>
                      {l.code} {l.name}
                      {l.memo && <span className="block text-xs text-secondary-500">{l.memo}</span>}
                    </td>
                    <td className="p-1 text-right font-mono">{l.debit ? kes(l.debit) : ""}</td>
                    <td className="p-1 text-right font-mono">{l.credit ? kes(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {open.kind === "AUTO" && (
              <p className="text-xs text-secondary-500">Posted automatically. To change it, correct or void what it came from; the books follow.</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
          <label>
            Kind
            <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPage(1); }} className={inputClass}>
              <option value="">All</option>
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={inputClass} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={inputClass} />
          </label>
          <label className="min-w-[12rem] flex-1">
            Search
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="e.g. Rent, a supplier's name" className={inputClass} />
          </label>
        </div>

        {list && (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-border text-left text-xs text-secondary-500">
                <tr>
                  <th className="p-2">No.</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">What</th>
                  <th className="p-2">Kind</th>
                  <th className="p-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} onClick={() => void show(r.id)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary-500/10">
                    <td className="p-2 font-mono">{r.number}</td>
                    <td className="p-2 whitespace-nowrap">{niceDay(r.date)}</td>
                    <td className={`p-2 ${r.reversedBy ? "text-secondary-500 line-through" : ""}`}>{r.memo}</td>
                    <td className="p-2 text-xs">{r.source ?? KIND_LABELS[r.kind]}{r.kind === "REVERSAL" ? " (reversal)" : ""}</td>
                    <td className="p-2 text-right font-mono">{kes(r.amount)}</td>
                  </tr>
                ))}
                {list.rows.length === 0 && (
                  <tr>
                    <td className="p-4 text-center text-secondary-500" colSpan={5}>
                      No entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {list && pages > 1 && (
          <div className="flex items-center gap-3 text-sm">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={quietButtonClass}>
              Newer
            </button>
            <span>
              Page {page} of {pages} ({list.total.toLocaleString()} entries)
            </span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className={quietButtonClass}>
              Older
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
