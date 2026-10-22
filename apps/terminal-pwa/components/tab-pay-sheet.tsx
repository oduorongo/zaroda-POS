"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, OfflineError, apiGet, apiPost } from "../lib/api";
import { kes, normalizeKenyanPhone, type Bill, type Tab } from "../lib/tabs";

type Method = "CASH" | "MPESA" | "CARD";
type Stk = "idle" | "sending" | "pending" | "success" | "failed";

interface Row {
  id: string;
  method: Method;
  amount: string;
  tendered: string;
  phone: string;
  stk: Stk;
  ref: string | null;
  error: string | null;
}
interface Person {
  name: string;
  lineIds: string[];
  total: number;
  tip: string;
  row: Row;
}

const METHODS: [Method, string][] = [
  ["CASH", "Cash"],
  ["MPESA", "M-Pesa"],
  ["CARD", "Card"],
];
const newRow = (method: Method, amount: number): Row => ({ id: crypto.randomUUID(), method, amount: amount > 0 ? amount.toFixed(2) : "", tendered: "", phone: "", stk: "idle", ref: null, error: null });
const input = "w-full rounded-md border border-slate-600 bg-slate-900 p-2.5";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

interface Props {
  tab: Tab;
  token: string;
  terminalId: string;
  cashierSessionId: string;
  onClose: () => void;
  /** Called after a payment went through. `closed` is true when the whole bill is now paid. */
  onDone: (message: string, closed: boolean) => void;
}

const explain = (err: unknown, fallback: string) => (err instanceof OfflineError ? "Offline - paying a bill needs a connection." : err instanceof ApiError ? err.message : fallback);

/**
 * Paying a bill: all of it (one or several payments - e.g. part cash, part card, or split equally) or by person (each person
 * gets their items and pays them). Cash, M-Pesa (a prompt to the customer's phone, confirmed before the sale is made) and card
 * (taken on the shop's own machine). A tip and service charge are kept apart from the bill. Each payment carries its own id, so
 * pressing Confirm twice (or retrying after a bad connection) can never charge twice.
 */
export default function TabPaySheet({ tab, token, terminalId, cashierSessionId, onClose, onDone }: Props) {
  const [mode, setMode] = useState<"ALL" | "PEOPLE">("ALL");
  const [rows, setRows] = useState<Row[]>(() => [newRow("CASH", tab.total)]);
  const [tip, setTip] = useState("");
  const [service, setService] = useState("");
  const [splitN, setSplitN] = useState("2");

  const [peopleCount, setPeopleCount] = useState(2);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [people, setPeople] = useState<Person[] | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useRef<Record<string, string>>({});
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const idFor = (key: string) => (ids.current[key] ??= crypto.randomUUID());

  const unpaid = tab.lines.filter((l) => l.status === "ORDERED");

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setPeople((ps) => ps && ps.map((p) => (p.row.id === id ? { ...p, row: { ...p.row, ...patch } } : p)));
  }

  /** Sends the prompt to the customer's phone and waits for them to approve it. The sale is only made once it is confirmed. */
  async function sendPrompt(row: Row, amount: number, reference: string) {
    const phone = normalizeKenyanPhone(row.phone);
    if (!phone) return patchRow(row.id, { error: "Enter a valid Safaricom number, e.g. 0712345678" });
    patchRow(row.id, { stk: "sending", error: null });
    try {
      const started = await apiPost<{ checkoutRequestId: string }>("/payments/mpesa/initiate", { amountKes: amount, reference, phoneNumber: phone }, token);
      patchRow(row.id, { stk: "pending" });
      for (let i = 0; i < 20 && alive.current; i++) {
        await sleep(3000);
        try {
          const s = await apiGet<{ status: "PENDING" | "SUCCESS" | "FAILED"; resultDesc: string | null }>(`/payments/mpesa/status/${started.checkoutRequestId}`, token);
          if (s.status === "SUCCESS") return patchRow(row.id, { stk: "success", ref: started.checkoutRequestId });
          if (s.status === "FAILED") return patchRow(row.id, { stk: "failed", error: s.resultDesc ?? "The customer did not complete the payment." });
        } catch {
          /* a dropped poll: keep trying until the time is up */
        }
      }
      patchRow(row.id, { stk: "failed", error: "No answer from M-Pesa yet - ask the customer to check their phone, then try again." });
    } catch (err) {
      patchRow(row.id, { stk: "failed", error: explain(err, "Could not send the M-Pesa prompt.") });
    }
  }

  const payment = (row: Row, amount: number) => ({
    method: row.method,
    amount,
    ...(row.method === "MPESA" ? { phoneNumber: normalizeKenyanPhone(row.phone) ?? undefined, providerReference: row.ref ?? undefined } : {}),
  });
  const rowReady = (row: Row) => (row.method !== "MPESA" || row.stk === "success") && num(row.amount) > 0;
  const changeFor = (row: Row, amount: number) => (row.method === "CASH" && num(row.tendered) > amount ? num(row.tendered) - amount : 0);

  // ── Everything ──
  const paid = rows.reduce((s, r) => s + num(r.amount), 0);
  const remaining = Math.round((tab.total - paid) * 100) / 100;
  const allOk = Math.abs(remaining) < 0.01 && rows.every(rowReady);

  async function splitEqually() {
    const n = Math.round(num(splitN));
    if (n < 2 || n > 20) return setError("Split between 2 and 20 people");
    setError(null);
    try {
      const bill = await apiGet<Bill>(`/restaurant/tabs/${tab.id}/bill?split=${n}`, token);
      setRows((bill.split ?? []).map((a) => newRow("CASH", a)));
    } catch (err) {
      setError(explain(err, "Could not work out the split."));
    }
  }

  async function payAll() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ closed: boolean }>(
        `/restaurant/tabs/${tab.id}/close`,
        {
          terminalId,
          cashierSessionId,
          clientId: idFor(`all:${rows.map((r) => `${r.method}${r.amount}`).join("|")}`),
          payments: rows.map((r) => payment(r, num(r.amount))),
          tipAmount: num(tip) || undefined,
          serviceChargeAmount: num(service) || undefined,
        },
        token,
      );
      const change = rows.reduce((s, r) => s + changeFor(r, num(r.amount)), 0);
      onDone(change > 0 ? `Paid. Change due: ${kes(change)}` : "Paid.", result.closed);
    } catch (err) {
      setError(explain(err, "The payment did not go through."));
    } finally {
      setBusy(false);
    }
  }

  // ── By person ──
  async function toPeoplePay() {
    setError(null);
    const groups = new Map<number, string[]>();
    for (const l of unpaid) groups.set(assign[l.id] ?? 0, [...(groups.get(assign[l.id] ?? 0) ?? []), l.id]);
    setBusy(true);
    try {
      const built: Person[] = [];
      for (const [i, lineIds] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
        const bill = await apiGet<Bill>(`/restaurant/tabs/${tab.id}/bill?lineIds=${lineIds.join(",")}`, token);
        built.push({ name: `Person ${i + 1}`, lineIds, total: bill.total, tip: "", row: newRow("CASH", bill.total) });
      }
      setPeople(built);
    } catch (err) {
      setError(explain(err, "Could not work out each person's share."));
    } finally {
      setBusy(false);
    }
  }

  async function payPeople() {
    if (!people) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ closed: boolean }>(
        `/restaurant/tabs/${tab.id}/close-split`,
        {
          terminalId,
          cashierSessionId,
          payers: people.map((p, i) => ({
            clientId: idFor(`person:${i}:${p.lineIds.join(",")}`),
            label: p.name,
            lineIds: p.lineIds,
            payments: [payment(p.row, p.total)],
            tipAmount: num(p.tip) || undefined,
          })),
        },
        token,
      );
      onDone("Everyone has paid.", result.closed);
    } catch (err) {
      setError(explain(err, "The payment did not go through."));
    } finally {
      setBusy(false);
    }
  }

  const methodButtons = (row: Row, amount: number) => (
    <div className="space-y-2">
      <div className="flex gap-2">
        {METHODS.map(([m, label]) => (
          <button
            key={m}
            type="button"
            disabled={row.stk === "pending" || row.stk === "sending" || row.stk === "success"}
            onClick={() => patchRow(row.id, { method: m, stk: "idle", ref: null, error: null })}
            className={`flex-1 rounded-md p-2 text-sm ${row.method === m ? "bg-primary-600 font-semibold" : "bg-slate-700"} disabled:opacity-50`}
          >
            {label}
          </button>
        ))}
      </div>
      {row.method === "CASH" && (
        <div>
          <input type="number" inputMode="decimal" className={input} placeholder="Cash given (to work out change)" value={row.tendered} onChange={(e) => patchRow(row.id, { tendered: e.target.value })} />
          {changeFor(row, amount) > 0 && <p className="mt-1 text-sm text-green-400">Change due: {kes(changeFor(row, amount))}</p>}
        </div>
      )}
      {row.method === "MPESA" && (
        <div className="space-y-2">
          <input className={input} inputMode="tel" placeholder="Customer's M-Pesa number, e.g. 0712 345 678" value={row.phone} disabled={row.stk !== "idle" && row.stk !== "failed"} onChange={(e) => patchRow(row.id, { phone: e.target.value })} />
          {row.stk === "success" ? (
            <p className="text-sm text-green-400">M-Pesa payment confirmed.</p>
          ) : (
            <button type="button" disabled={row.stk === "sending" || row.stk === "pending" || amount <= 0} onClick={() => void sendPrompt(row, amount, idFor(`stk:${row.id}`))} className="w-full rounded-md bg-green-700 p-2.5 text-sm font-semibold disabled:opacity-50">
              {row.stk === "sending" ? "Sending..." : row.stk === "pending" ? "Waiting for the customer to approve..." : `Send M-Pesa prompt for ${kes(amount)}`}
            </button>
          )}
          {row.error && <p className="text-sm text-red-400">{row.error}</p>}
        </div>
      )}
      {row.method === "CARD" && <p className="text-xs text-slate-400">Take the card on your card machine, then confirm here.</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-slate-800 p-5 sm:rounded-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">Pay the bill</h2>
            <p className="text-slate-400">
              {tab.table.label} · {kes(tab.total)}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            Close
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <button onClick={() => setMode("ALL")} className={`flex-1 rounded-md p-2 text-sm ${mode === "ALL" ? "bg-primary-600 font-semibold" : "bg-slate-700"}`}>
            Pay it all
          </button>
          <button onClick={() => setMode("PEOPLE")} disabled={unpaid.length < 2} className={`flex-1 rounded-md p-2 text-sm ${mode === "PEOPLE" ? "bg-primary-600 font-semibold" : "bg-slate-700"} disabled:opacity-40`}>
            Split by person
          </button>
        </div>

        {error && <p className="mt-3 rounded-md bg-red-900 p-2 text-sm">{error}</p>}

        {mode === "ALL" && (
          <div className="mt-4 space-y-4">
            <div className="flex items-end gap-2">
              <label className="flex-1 text-sm">
                Split equally between
                <input type="number" min={2} max={20} className={input} value={splitN} onChange={(e) => setSplitN(e.target.value)} />
              </label>
              <button onClick={() => void splitEqually()} className="rounded-md bg-slate-700 px-4 py-2.5 text-sm hover:bg-slate-600">
                Split
              </button>
            </div>

            {rows.map((row, i) => (
              <div key={row.id} className="space-y-2 rounded-lg border border-slate-700 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Payment {i + 1}</span>
                  {rows.length > 1 && row.stk === "idle" && (
                    <button onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))} className="text-xs text-red-400">
                      Remove
                    </button>
                  )}
                </div>
                <input type="number" inputMode="decimal" className={input} value={row.amount} disabled={row.stk !== "idle" && row.stk !== "failed"} onChange={(e) => patchRow(row.id, { amount: e.target.value })} />
                {methodButtons(row, num(row.amount))}
              </div>
            ))}

            <button onClick={() => setRows((rs) => [...rs, newRow("CASH", Math.max(0, remaining))])} className="w-full rounded-md bg-slate-700 p-2 text-sm hover:bg-slate-600">
              + Add another payment
            </button>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Tip <span className="text-slate-500">(kept separate)</span>
                <input type="number" inputMode="decimal" min={0} className={input} value={tip} onChange={(e) => setTip(e.target.value)} />
              </label>
              <label className="text-sm">
                Service charge
                <input type="number" inputMode="decimal" min={0} className={input} value={service} onChange={(e) => setService(e.target.value)} />
              </label>
            </div>

            <p className={`text-sm ${Math.abs(remaining) < 0.01 ? "text-green-400" : "text-amber-400"}`}>
              {Math.abs(remaining) < 0.01 ? "The payments cover the bill." : remaining > 0 ? `${kes(remaining)} still to be covered.` : `The payments are ${kes(-remaining)} too much.`}
            </p>
            <button onClick={() => void payAll()} disabled={busy || !allOk} className="w-full rounded-md bg-primary-600 p-3 font-semibold hover:bg-primary-500 disabled:opacity-40">
              {busy ? "Paying..." : `Confirm payment of ${kes(tab.total)}`}
            </button>
          </div>
        )}

        {mode === "PEOPLE" && !people && (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              How many people are paying?
              <input type="number" min={2} max={8} className={input} value={peopleCount} onChange={(e) => setPeopleCount(Math.min(8, Math.max(2, Math.round(num(e.target.value)) || 2)))} />
            </label>
            <p className="text-sm text-slate-400">Choose who is paying for each item.</p>
            {unpaid.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-900 p-2">
                <span className="text-sm">
                  {l.quantity} x {l.title}
                </span>
                <select value={assign[l.id] ?? 0} onChange={(e) => setAssign((a) => ({ ...a, [l.id]: Number(e.target.value) }))} className="rounded-md border border-slate-600 bg-slate-800 p-2 text-sm">
                  {Array.from({ length: peopleCount }, (_, i) => (
                    <option key={i} value={i}>
                      Person {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <button onClick={() => void toPeoplePay()} disabled={busy} className="w-full rounded-md bg-primary-600 p-3 font-semibold disabled:opacity-40">
              {busy ? "Working..." : "Next: how each person pays"}
            </button>
          </div>
        )}

        {mode === "PEOPLE" && people && (
          <div className="mt-4 space-y-4">
            {people.map((p) => (
              <div key={p.row.id} className="space-y-2 rounded-lg border border-slate-700 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.name}</span>
                  <span className="font-mono">{kes(p.total)}</span>
                </div>
                {methodButtons(p.row, p.total)}
                <label className="block text-sm">
                  Tip <span className="text-slate-500">(optional)</span>
                  <input type="number" inputMode="decimal" min={0} className={input} value={p.tip} onChange={(e) => setPeople((ps) => ps && ps.map((x) => (x.row.id === p.row.id ? { ...x, tip: e.target.value } : x)))} />
                </label>
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={() => setPeople(null)} className="flex-1 rounded-md bg-slate-700 p-3">
                Back
              </button>
              <button onClick={() => void payPeople()} disabled={busy || !people.every((p) => (p.row.method !== "MPESA" || p.row.stk === "success"))} className="flex-1 rounded-md bg-primary-600 p-3 font-semibold disabled:opacity-40">
                {busy ? "Paying..." : "Confirm payments"}
              </button>
            </div>
            <p className="text-xs text-slate-500">Each person gets their own sale. If one fails, the ones before it stay paid and the bill shows what is left.</p>
          </div>
        )}
      </div>
    </div>
  );
}
