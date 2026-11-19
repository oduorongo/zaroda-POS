"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { API, Account, AccountingTabs, buttonClass, inputClass, kes, monthStart, niceDay, quietButtonClass, Shell, todayKey, useBooksSession } from "../shared";

interface Line {
  id: string;
  kind: "PAYMENT" | "TOP_UP" | "COUNT";
  date: string;
  voucherNumber: string | null;
  account: string | null;
  description: string | null;
  receivedBy: string | null;
  topUpFrom: string | null;
  countedAmount: number | null;
  recordedByName: string | null;
  voided: boolean;
  voidReason: string | null;
  moneyIn: number;
  moneyOut: number;
  balance: number;
}
interface Book {
  float: number;
  balance: number;
  topUpNeeded: number;
  from: string;
  to: string;
  opening: number;
  lines: Line[];
  closing: number;
}
type Action = "pay" | "topup" | "count" | "float" | null;
const FROM = [
  ["CASH", "Cash on hand"],
  ["MPESA", "M-Pesa and Tuma"],
  ["BANK", "Bank"],
] as const;

/** ZARODA's own petty cash: vouchers charged to ZARODA's cost accounts, top-ups, counts, and the petty cash book. Posted at once. */
export default function PlatformPettyCashPage() {
  const session = useBooksSession();
  const [book, setBook] = useState<Book | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKey);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // form fields
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [topFrom, setTopFrom] = useState<"CASH" | "MPESA" | "BANK">("BANK");
  const [counted, setCounted] = useState("");
  const [floatAmount, setFloatAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayKey);

  const load = useCallback(async () => {
    try {
      const [b, a] = await Promise.all([apiGet<Book>(`${API}/petty-cash?from=${from}&to=${to}`), apiGet<Account[]>(`${API}/accounts`)]);
      setBook(b);
      setAccounts(a.filter((x) => x.type === "EXPENSE" && x.active && x.systemKey !== "INCOME_TAX"));
      setFloatAmount(String(b.float));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load petty cash.");
    }
  }, [from, to]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  function open(a: Action) {
    setAction(action === a ? null : a);
    setAmount(a === "topup" && book?.topUpNeeded ? String(book.topUpNeeded) : "");
    setDescription("");
    setReceivedBy("");
    setCounted("");
    setOccurredOn(todayKey());
  }

  async function run(fn: () => Promise<unknown>, done: string, fallback: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      setError(null);
      setAction(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function voidLine(l: Line) {
    const reason = window.prompt(`Void ${l.voucherNumber ?? (l.kind === "TOP_UP" ? "this top-up" : "this count")}? Its journal is reversed. Say why:`);
    if (!reason?.trim()) return;
    await run(() => apiPost(`${API}/petty-cash/${l.id}/void`, { reason: reason.trim() }), "Voided and reversed in the books.", "Could not void it.");
  }

  if (!session) return null;

  return (
    <Shell session={session}>
      <main className="mx-auto max-w-4xl space-y-5 p-6">
        <div className="print:hidden">
          <h1 className="text-xl font-bold">ZARODA&apos;s books</h1>
          <AccountingTabs />
        </div>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300 print:hidden">{error}</p>}
        {notice && <p className="rounded-md bg-green-600/10 p-3 text-sm text-green-700 print:hidden">{notice}</p>}

        {book && (
          <div className="grid gap-3 sm:grid-cols-3 print:hidden">
            <Tile label="In petty cash" value={kes(book.balance)} />
            <Tile label="Float" value={kes(book.float)} />
            <Tile label="To top up" value={kes(book.topUpNeeded)} />
          </div>
        )}

        <div className="flex flex-wrap gap-2 print:hidden">
          <button onClick={() => open("pay")} className={buttonClass}>Pay out (voucher)</button>
          <button onClick={() => open("topup")} className={quietButtonClass}>Top up</button>
          <button onClick={() => open("count")} className={quietButtonClass}>Count</button>
          <button onClick={() => open("float")} className={quietButtonClass}>Set the float</button>
        </div>

        {action === "pay" && book && (
          <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 print:hidden">
            <label>
              Amount (KES)
              <input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
              {Number(amount) > book.balance && <span className="mt-1 block text-xs text-red-600">More than is in petty cash. Top it up first.</span>}
            </label>
            <label>
              Charged to
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                <option value="">Choose a cost account...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </select>
            </label>
            <label>
              Details
              <input maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Office tea and sugar" className={inputClass} />
            </label>
            <label>
              Paid to
              <input maxLength={100} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className={inputClass} />
            </label>
            <label>
              Date
              <input type="date" max={todayKey()} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={inputClass} />
            </label>
            <div className="flex items-end">
              <button
                disabled={busy || !(Number(amount) > 0) || Number(amount) > book.balance || !accountId || description.trim().length < 2 || receivedBy.trim().length < 2}
                onClick={() => void run(() => apiPost(`${API}/petty-cash/pay`, { amount: Number(amount), accountId, description: description.trim(), receivedBy: receivedBy.trim(), occurredOn }), `${kes(Number(amount))} paid out and posted.`, "Could not record the payment.")}
                className={buttonClass}
              >
                Record the voucher
              </button>
            </div>
          </div>
        )}

        {action === "topup" && (
          <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3 print:hidden">
            <label>
              Amount (KES)
              <input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
            </label>
            <label>
              From
              <select value={topFrom} onChange={(e) => setTopFrom(e.target.value as typeof topFrom)} className={inputClass}>
                {FROM.map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input type="date" max={todayKey()} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={inputClass} />
            </label>
            <div className="sm:col-span-3">
              <button
                disabled={busy || !(Number(amount) > 0)}
                onClick={() => void run(() => apiPost(`${API}/petty-cash/top-up`, { amount: Number(amount), from: topFrom, occurredOn }), `${kes(Number(amount))} put into petty cash and posted.`, "Could not record the top-up.")}
                className={buttonClass}
              >
                Record the top-up
              </button>
            </div>
          </div>
        )}

        {action === "count" && book && (
          <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 print:hidden">
            <label>
              Cash counted (KES)
              <input type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} className={inputClass} />
              <span className="mt-1 block text-xs text-secondary-500">There should be {kes(book.balance)}. A shortage goes to Other expenses, a surplus to Other income.</span>
            </label>
            <div className="flex items-end">
              <button
                disabled={busy || counted === ""}
                onClick={() => void run(() => apiPost(`${API}/petty-cash/count`, { counted: Number(counted) }), "Count recorded.", "Could not record the count.")}
                className={buttonClass}
              >
                Record the count
              </button>
            </div>
          </div>
        )}

        {action === "float" && (
          <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 print:hidden">
            <label>
              Float (KES)
              <input type="number" min={0} step="0.01" value={floatAmount} onChange={(e) => setFloatAmount(e.target.value)} className={inputClass} />
              <span className="mt-1 block text-xs text-secondary-500">What petty cash is topped back up to.</span>
            </label>
            <div className="flex items-end">
              <button
                disabled={busy || floatAmount === ""}
                onClick={() => void run(() => apiPatch(`${API}/settings`, { pettyCashFloat: Number(floatAmount) }), "Float saved.", "Could not save the float.")}
                className={buttonClass}
              >
                Save the float
              </button>
            </div>
          </div>
        )}

        {book && (
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm print:border-0 print:p-0">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">ZARODA petty cash book</h2>
                <p className="text-xs text-secondary-500">{niceDay(book.from)} to {niceDay(book.to)}</p>
              </div>
              <div className="flex flex-wrap items-end gap-2 print:hidden">
                <label className="text-xs">
                  From
                  <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
                </label>
                <label className="text-xs">
                  To
                  <input type="date" value={to} max={todayKey()} onChange={(e) => setTo(e.target.value)} className={inputClass} />
                </label>
                <button onClick={() => window.print()} className={quietButtonClass}>Print</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-secondary-500">
                    <th className="py-1 pr-2">Date</th>
                    <th className="pr-2">Voucher</th>
                    <th className="pr-2">Details</th>
                    <th className="pr-2 text-right">In</th>
                    <th className="pr-2 text-right">Out</th>
                    <th className="pr-2 text-right">Balance</th>
                    <th className="print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-1" colSpan={5}>Brought forward</td>
                    <td className="pr-2 text-right font-mono">{kes(book.opening)}</td>
                    <td className="print:hidden" />
                  </tr>
                  {book.lines.map((l) => (
                    <tr key={l.id} className={`border-b border-border align-top ${l.voided ? "text-secondary-500 line-through" : ""}`}>
                      <td className="whitespace-nowrap py-1 pr-2">{niceDay(l.date)}</td>
                      <td className="whitespace-nowrap pr-2">{l.voucherNumber ?? ""}</td>
                      <td className="pr-2">
                        {l.kind === "PAYMENT" && `${l.account ?? ""}: ${l.description ?? ""} (to ${l.receivedBy ?? ""})`}
                        {l.kind === "TOP_UP" && `Top-up from ${FROM.find(([k]) => k === l.topUpFrom)?.[1] ?? l.topUpFrom}`}
                        {l.kind === "COUNT" && `${l.description ?? "Counted"} (counted ${kes(l.countedAmount ?? 0)})`}
                        {l.recordedByName ? <span className="block text-secondary-500">by {l.recordedByName}</span> : null}
                        {l.voided && <span className="block">Voided: {l.voidReason}</span>}
                      </td>
                      <td className="pr-2 text-right font-mono">{l.moneyIn ? kes(l.moneyIn) : ""}</td>
                      <td className="pr-2 text-right font-mono">{l.moneyOut ? kes(l.moneyOut) : ""}</td>
                      <td className="pr-2 text-right font-mono">{kes(l.balance)}</td>
                      <td className="print:hidden">
                        {!l.voided && (
                          <button onClick={() => void voidLine(l)} className="text-red-600 hover:underline">Void</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={5} className="py-1 pr-2 text-right">Carried forward</td>
                    <td className="pr-2 text-right font-mono">{kes(book.closing)}</td>
                    <td className="print:hidden" />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="hidden pt-8 text-xs print:block">Checked by: ____________________ Signature: ____________________ Date: ______________</p>
          </section>
        )}
      </main>
    </Shell>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-secondary-500">{label}</p>
      <p className="text-xl font-bold">KES {value}</p>
    </div>
  );
}
