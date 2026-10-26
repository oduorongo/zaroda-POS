"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Line {
  source: string;
  ref: string;
  label: string;
  amount: number;
  date: string;
  note: string | null;
}
interface Week {
  index: number;
  start: string;
  end: string;
  inflow: number;
  outflow: number;
  net: number;
  opening: number;
  closing: number;
  belowMinimum: boolean;
  inflows: Line[];
  outflows: Line[];
}
interface Item {
  id: string;
  direction: "IN" | "OUT";
  description: string;
  amount: number;
  date: string;
  repeat: "NONE" | "WEEKLY" | "MONTHLY";
  repeatUntil: string | null;
  notes: string | null;
  active: boolean;
}
interface Forecast {
  today: string;
  settings: { openingCash: number; openingCashAsOf: string | null; minimumCash: number };
  forecast: {
    weeks: Week[];
    totalIn: number;
    totalOut: number;
    closing: number;
    lowest: { week: number; closing: number };
    firstBelowMinimum: number | null;
    later: { inflow: number; outflow: number };
  };
  notCounted: { source: string; ref: string; label: string; amount: number; reason: string }[];
  planned: Item[];
  warnings: string[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const SOURCE: Record<string, string> = { INVOICE: "Invoice", RETENTION: "Retention", ORDER: "Order to deliver", BILL: "Bill to pay", PLANNED: "Planned" };

/** The next 13 weeks of cash: what is expected in and out each week, and where it runs low. */
export default function SchoolCashflowPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Forecast | null>(null);
  const [collect, setCollect] = useState("100");
  const [delay, setDelay] = useState("0");
  const [retention, setRetention] = useState(true);
  const [bills, setBills] = useState(true);
  const [pipeline, setPipeline] = useState(false);
  const [disputed, setDisputed] = useState(false);
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [cash, setCash] = useState({ openingCash: "", minimumCash: "" });
  const [item, setItem] = useState<{ id: string | null; direction: "IN" | "OUT"; description: string; amount: string; date: string; repeat: "NONE" | "WEEKLY" | "MONTHLY"; repeatUntil: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({
        collectPercent: collect || "100",
        delayDays: delay || "0",
        includeRetention: String(retention),
        includeBills: String(bills),
        includePipeline: String(pipeline),
        includeDisputed: String(disputed),
      });
      const d = await apiGet<Forecast>(`/school-supplier/cashflow?${q.toString()}`);
      setData(d);
      setCash((c) => (c.openingCash === "" && c.minimumCash === "" ? { openingCash: String(d.settings.openingCash), minimumCash: String(d.settings.minimumCash) } : c));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not work out the forecast.");
    }
  }, [collect, delay, retention, bills, pipeline, disputed]);

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
  }, [router]);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;
  const f = data?.forecast;
  const maxBar = f ? Math.max(1, ...f.weeks.map((w) => Math.max(Math.abs(w.closing), 1))) : 1;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Cash-flow forecast</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/school-money" className="text-primary-600 hover:underline">Invoices &amp; payments</Link>
            <Link href="/school-contracts" className="text-primary-600 hover:underline">Contracts</Link>
            <Link href="/school-orders" className="text-primary-600 hover:underline">School orders</Link>
          </div>
        </div>
        <p className="text-sm text-secondary-500">The next 13 weeks of cash, week by week. It starts from the cash you have now, adds what schools are expected to pay and takes off your bills and planned payments. Open a week to see exactly what is in it. It is a forecast, not a promise: try the &quot;what if&quot; boxes to see a worse case.</p>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        {data?.warnings.map((w) => (
          <p key={w} className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">{w}</p>
        ))}

        {data && (
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
            <p className="font-semibold">Where you start</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label>
                Cash you have now (KES) <span className="text-secondary-500">bank, M-Pesa and cash together</span>
                <input type="number" step="0.01" value={cash.openingCash} onChange={(e) => setCash({ ...cash, openingCash: e.target.value })} disabled={!canEdit} className={field} />
              </label>
              <label>
                Least cash you want to keep (KES)
                <input type="number" min={0} step="0.01" value={cash.minimumCash} onChange={(e) => setCash({ ...cash, minimumCash: e.target.value })} disabled={!canEdit} className={field} />
              </label>
              {canEdit && (
                <div className="flex items-end">
                  <button
                    disabled={busy || cash.openingCash === ""}
                    onClick={() => void run(() => apiPut("/school-supplier/cashflow/settings", { openingCash: Number(cash.openingCash), minimumCash: Number(cash.minimumCash || 0) }), "Saved.")}
                    className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-secondary-500">{data.settings.openingCashAsOf ? `Last entered ${data.settings.openingCashAsOf}.` : "Not entered yet."}</p>
          </section>
        )}

        <section className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="font-semibold">What if...</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label>
              Share of school money that arrives (%)
              <input type="number" min={0} max={100} value={collect} onChange={(e) => setCollect(e.target.value)} className={field} />
            </label>
            <label>
              Schools pay this many days late
              <input type="number" min={0} max={180} value={delay} onChange={(e) => setDelay(e.target.value)} className={field} />
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="checkbox" checked={retention} onChange={(e) => setRetention(e.target.checked)} /> Count retention being released</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={bills} onChange={(e) => setBills(e.target.checked)} /> Count supplier bills</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={pipeline} onChange={(e) => setPipeline(e.target.checked)} /> Count confirmed orders not yet delivered</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={disputed} onChange={(e) => setDisputed(e.target.checked)} /> Count disputed invoices</label>
          </div>
        </section>

        {f && data && (
          <>
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-secondary-500">Cash now</p>
                <p className="font-mono text-lg font-bold">{kes(data.settings.openingCash)}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-secondary-500">After 13 weeks</p>
                <p className={`font-mono text-lg font-bold ${f.closing < 0 ? "text-red-400" : ""}`}>{kes(f.closing)}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-secondary-500">Lowest point</p>
                <p className={`font-mono text-lg font-bold ${f.lowest.closing < data.settings.minimumCash ? "text-red-400" : ""}`}>{kes(f.lowest.closing)}</p>
                <p className="text-xs text-secondary-500">week {f.lowest.week}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-secondary-500">Below your minimum</p>
                <p className={`text-lg font-bold ${f.firstBelowMinimum ? "text-red-400" : "text-green-400"}`}>{f.firstBelowMinimum ? `from week ${f.firstBelowMinimum}` : "never"}</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-border text-left text-xs text-secondary-500">
                  <tr>
                    <th className="p-2">Week</th>
                    <th className="p-2 text-right">Money in</th>
                    <th className="p-2 text-right">Money out</th>
                    <th className="p-2 text-right">Cash at the end</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {f.weeks.map((w) => (
                    <Fragment key={w.index}>
                      <tr className="cursor-pointer border-b border-border/60 hover:bg-secondary-500/5" onClick={() => setOpenWeek(openWeek === w.index ? null : w.index)}>
                        <td className="p-2">
                          <span className="font-semibold">{w.index}</span> <span className="text-xs text-secondary-500">{w.start.slice(5)} to {w.end.slice(5)}</span>
                        </td>
                        <td className="p-2 text-right font-mono text-green-400">{w.inflow > 0 ? kes(w.inflow) : "-"}</td>
                        <td className="p-2 text-right font-mono text-red-400">{w.outflow > 0 ? kes(w.outflow) : "-"}</td>
                        <td className={`p-2 text-right font-mono font-semibold ${w.closing < 0 ? "text-red-400" : w.belowMinimum ? "text-amber-400" : ""}`}>{kes(w.closing)}</td>
                        <td className="w-24 p-2">
                          <div className="h-2 rounded bg-secondary-500/20">
                            <div className={`h-2 rounded ${w.closing < 0 ? "bg-red-500" : w.belowMinimum ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, (Math.abs(w.closing) / maxBar) * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                      {openWeek === w.index && (
                        <tr className="border-b border-border/60 bg-secondary-500/5">
                          <td colSpan={5} className="space-y-2 p-3 text-xs">
                            {w.inflows.length === 0 && w.outflows.length === 0 && <p className="text-secondary-500">Nothing expected this week.</p>}
                            {[...w.inflows.map((l) => ({ l, sign: 1 })), ...w.outflows.map((l) => ({ l, sign: -1 }))].map(({ l, sign }) => (
                              <p key={`${l.source}-${l.ref}-${l.date}-${sign}`} className="flex flex-wrap justify-between gap-2">
                                <span>
                                  <span className="mr-2 rounded bg-secondary-500/20 px-1.5 py-0.5">{SOURCE[l.source] ?? l.source}</span>
                                  {l.label} <span className="text-secondary-500">{l.date}{l.note ? ` · ${l.note}` : ""}</span>
                                </span>
                                <span className={`font-mono ${sign > 0 ? "text-green-400" : "text-red-400"}`}>{sign > 0 ? "+" : "-"}{kes(l.amount)}</span>
                              </p>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-semibold">
                  <tr>
                    <td className="p-2">Total</td>
                    <td className="p-2 text-right font-mono">{kes(f.totalIn)}</td>
                    <td className="p-2 text-right font-mono">{kes(f.totalOut)}</td>
                    <td className="p-2 text-right font-mono">{kes(f.closing)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            {(f.later.inflow > 0 || f.later.outflow > 0) && (
              <p className="text-xs text-secondary-500">
                Beyond the 13 weeks (not counted above): {kes(f.later.inflow)} expected in, {kes(f.later.outflow)} to pay.
              </p>
            )}

            {data.notCounted.length > 0 && (
              <div>
                <p className="mb-1 text-xs uppercase text-secondary-500">Left out, and why</p>
                <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
                  {data.notCounted.map((n) => (
                    <li key={`${n.source}-${n.ref}`} className="flex flex-wrap items-center justify-between gap-2 p-2">
                      <span>
                        {n.label} <span className="text-xs text-secondary-500">{n.reason}</span>
                      </span>
                      <span className="font-mono">{kes(n.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase text-secondary-500">Planned money in and out</p>
                {canEdit && !item && (
                  <button onClick={() => setItem({ id: null, direction: "OUT", description: "", amount: "", date: today(), repeat: "NONE", repeatUntil: "" })} className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700">
                    Add one
                  </button>
                )}
              </div>
              <p className="text-xs text-secondary-500">For money that is not on an invoice or a bill: salaries, rent, a loan repayment, a grant. It can repeat every week or month.</p>
              {item && (
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2">
                  <label>
                    Money
                    <select value={item.direction} onChange={(e) => setItem({ ...item, direction: e.target.value as "IN" | "OUT" })} className={field}>
                      <option value="OUT">Going out</option>
                      <option value="IN">Coming in</option>
                    </select>
                  </label>
                  <label>
                    What is it?
                    <input value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} placeholder="Salaries" className={field} />
                  </label>
                  <label>
                    Amount (KES)
                    <input type="number" min={0} step="0.01" value={item.amount} onChange={(e) => setItem({ ...item, amount: e.target.value })} className={field} />
                  </label>
                  <label>
                    On (or from)
                    <input type="date" value={item.date} onChange={(e) => setItem({ ...item, date: e.target.value })} className={field} />
                  </label>
                  <label>
                    Repeats
                    <select value={item.repeat} onChange={(e) => setItem({ ...item, repeat: e.target.value as "NONE" | "WEEKLY" | "MONTHLY" })} className={field}>
                      <option value="NONE">Once</option>
                      <option value="WEEKLY">Every week</option>
                      <option value="MONTHLY">Every month</option>
                    </select>
                  </label>
                  {item.repeat !== "NONE" && (
                    <label>
                      Until <span className="text-secondary-500">(optional)</span>
                      <input type="date" value={item.repeatUntil} onChange={(e) => setItem({ ...item, repeatUntil: e.target.value })} className={field} />
                    </label>
                  )}
                  <div className="flex gap-2 sm:col-span-2">
                    <button
                      disabled={busy || item.description.trim().length < 2 || !(Number(item.amount) > 0)}
                      onClick={() =>
                        void run(async () => {
                          const body = { direction: item.direction, description: item.description.trim(), amount: Number(item.amount), date: item.date, repeat: item.repeat, repeatUntil: item.repeat !== "NONE" && item.repeatUntil ? item.repeatUntil : undefined };
                          if (item.id) await apiPut(`/school-supplier/cashflow/items/${item.id}`, body);
                          else await apiPost("/school-supplier/cashflow/items", body);
                          setItem(null);
                        }, "Saved.")
                      }
                      className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button onClick={() => setItem(null)} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-500/10">Cancel</button>
                  </div>
                </div>
              )}
              {data.planned.length === 0 && !item && <p className="rounded-lg border border-border bg-surface p-3 text-sm text-secondary-500">Nothing planned yet.</p>}
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
                {data.planned.map((p) => (
                  <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 p-3 ${p.active ? "" : "opacity-50"}`}>
                    <div>
                      <p className="font-semibold">
                        {p.description} {!p.active && <span className="text-xs font-normal text-secondary-500">(switched off)</span>}
                      </p>
                      <p className="text-xs text-secondary-500">
                        {p.direction === "IN" ? "Coming in" : "Going out"} · {p.date}
                        {p.repeat === "WEEKLY" ? " · every week" : p.repeat === "MONTHLY" ? " · every month" : ""}
                        {p.repeatUntil ? ` until ${p.repeatUntil}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono font-semibold ${p.direction === "IN" ? "text-green-400" : "text-red-400"}`}>{kes(p.amount)}</span>
                      {canEdit && (
                        <>
                          <button onClick={() => setItem({ id: p.id, direction: p.direction, description: p.description, amount: String(p.amount), date: p.date, repeat: p.repeat, repeatUntil: p.repeatUntil ?? "" })} className="text-xs text-primary-600 hover:underline">Change</button>
                          <button
                            onClick={() => void run(() => apiPut(`/school-supplier/cashflow/items/${p.id}`, { direction: p.direction, description: p.description, amount: p.amount, date: p.date, repeat: p.repeat, repeatUntil: p.repeatUntil ?? undefined, active: !p.active }), p.active ? "Switched off." : "Switched on.")}
                            className="text-xs text-primary-600 hover:underline"
                          >
                            {p.active ? "Switch off" : "Switch on"}
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Remove "${p.description}"?`)) void run(() => apiDelete(`/school-supplier/cashflow/items/${p.id}`), "Removed.");
                            }}
                            className="text-xs text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        {!data && !error && <p className="py-6 text-center text-secondary-500">Working it out...</p>}
      </main>
    </div>
  );
}
