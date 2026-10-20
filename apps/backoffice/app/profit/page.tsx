"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Money {
  saleCount: number;
  sales: number;
  tax: number;
  refunds: number;
  netSales: number;
  costOfGoods: number;
  grossProfit: number;
  waste: number;
  expenses: number;
  payroll: number;
  netProfit: number;
}
interface Profit {
  from: string;
  to: string;
  groupBy: "day" | "week" | "month";
  totals: Money;
  periods: (Money & { key: string })[];
  expensesByCategory: { category: string; label: string; amount: number }[];
  unknownCostLines: number;
  costNote: string | null;
}
interface Branch {
  id: string;
  name: string;
}

type Preset = "today" | "week" | "month" | "lastMonth" | "custom";

const kes = (n: number) => `${n < 0 ? "-" : ""}KES ${Math.abs(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (n: number) => (n === 0 ? "-" : `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`);
// Nairobi is always UTC+3, so "today" is worked out from that, whatever the device's own clock zone is.
const todayKey = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const endOfMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

function rangeFor(preset: Preset): { from: string; to: string } | null {
  const today = todayKey();
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") return { from: mondayOf(today), to: today };
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "lastMonth") {
    const last = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    return { from: `${last}-01`, to: endOfMonth(last) };
  }
  return null;
}

function labelFor(key: string, groupBy: "day" | "week" | "month") {
  if (groupBy === "month") return new Date(`${key}-15T00:00:00Z`).toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" });
  const day = new Date(`${key}T00:00:00Z`);
  if (groupBy === "day") return day.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const end = new Date(day.getTime() + 6 * 86_400_000);
  return `${day.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" })} - ${end.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

const PRESETS: [Preset, string][] = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["lastMonth", "Last month"],
  ["custom", "Pick dates"],
];

/** Sales, minus what the goods cost and what the business spent: how much it really made, by day, week or month. */
export default function ProfitPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(rangeFor("month")!.from);
  const [to, setTo] = useState(rangeFor("month")!.to);
  const [groupBy, setGroupBy] = useState<"" | "day" | "week" | "month">("");
  const [branchId, setBranchId] = useState("");
  const [data, setData] = useState<Profit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    void apiGet<Branch[]>("/branches").then(setBranches).catch(() => undefined);
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ from, to });
      if (groupBy) query.set("groupBy", groupBy);
      if (branchId) query.set("branchId", branchId);
      setData(await apiGet<Profit>(`/reports/profit?${query.toString()}`));
      setError(null);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Could not work out your profit.");
    } finally {
      setLoading(false);
    }
  }, [from, to, groupBy, branchId]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  function choose(next: Preset) {
    setPreset(next);
    const range = rangeFor(next);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    }
  }

  if (!session) return null;
  const t = data?.totals;
  const margin = t && t.netSales > 0 ? Math.round((t.grossProfit / t.netSales) * 1000) / 10 : null;
  const profit = (t?.netProfit ?? 0) >= 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Profit &amp; loss</h1>
          <Link href="/expenses" className="text-sm text-primary-600 hover:underline">
            Record an expense &rarr;
          </Link>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => choose(key)}
                className={`rounded-full border px-3 py-1.5 text-sm ${preset === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {preset === "custom" && (
              <>
                <label className="text-sm">
                  From
                  <input type="date" max={todayKey()} value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-md border border-border bg-surface p-2 text-sm" />
                </label>
                <label className="text-sm">
                  To
                  <input type="date" max={todayKey()} value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-md border border-border bg-surface p-2 text-sm" />
                </label>
              </>
            )}
            <label className="text-sm">
              Show by
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="mt-1 block rounded-md border border-border bg-surface p-2 text-sm">
                <option value="">Automatic</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
            {branches.length > 1 && (
              <label className="text-sm">
                Branch
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 block rounded-md border border-border bg-surface p-2 text-sm">
                  <option value="">All branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && !data && <p className="text-sm text-secondary-500">Working it out...</p>}

        {t && data && (
          <>
            <div className={`rounded-lg border p-5 ${profit ? "border-green-600/40 bg-green-600/10" : "border-red-600/40 bg-red-600/10"}`}>
              <p className="text-sm text-secondary-600">{profit ? "You made" : "You lost"}</p>
              <p className={`text-3xl font-bold ${profit ? "text-green-600" : "text-red-600"}`}>{kes(Math.abs(t.netProfit))}</p>
              <p className="text-xs text-secondary-500">
                {labelFor(data.from, "day")} to {labelFor(data.to, "day")}
                {margin !== null ? ` · margin on sales ${margin}%` : ""}
              </p>
            </div>

            {data.costNote && <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-900">{data.costNote}</p>}

            <div className="rounded-lg border border-border bg-surface p-4 text-sm">
              <h2 className="mb-2 font-semibold">How it adds up</h2>
              <dl className="space-y-1">
                <Row label={`Sales (${t.saleCount} ${t.saleCount === 1 ? "sale" : "sales"})`} value={kes(t.sales)} hint="What customers paid you" />
                <Row label="less tax collected" value={kes(-t.tax)} hint="Not your money - it goes to the government" />
                <Row label="less refunds" value={kes(-t.refunds)} />
                <Row label="Net sales" value={kes(t.netSales)} strong />
                <Row label="less cost of the goods sold" value={kes(-t.costOfGoods)} hint="What the items you sold cost you" />
                <Row label="Gross profit (the margin)" value={kes(t.grossProfit)} strong />
                <Row label="less waste and spoilage" value={kes(-t.waste)} />
                <Row label="less expenses you recorded" value={kes(-t.expenses)} />
                {t.payroll > 0 && <Row label="less salaries paid through Payroll" value={kes(-t.payroll)} />}
                <Row label={profit ? "Profit" : "Loss"} value={kes(t.netProfit)} strong />
              </dl>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="border-b border-border text-left text-xs text-secondary-500">
                  <tr>
                    <th className="p-2">{data.groupBy === "day" ? "Day" : data.groupBy === "week" ? "Week" : "Month"}</th>
                    <th className="p-2 text-right">Sales</th>
                    <th className="p-2 text-right">Gross profit</th>
                    <th className="p-2 text-right">Expenses etc.</th>
                    <th className="p-2 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.periods.map((p) => (
                    <tr key={p.key} className="border-b border-border/60 last:border-0">
                      <td className="p-2">{labelFor(p.key, data.groupBy)}</td>
                      <td className="p-2 text-right font-mono">{short(p.netSales)}</td>
                      <td className="p-2 text-right font-mono">{short(p.grossProfit)}</td>
                      <td className="p-2 text-right font-mono">{short(p.waste + p.expenses + p.payroll)}</td>
                      <td className={`p-2 text-right font-mono font-semibold ${p.netProfit < 0 ? "text-red-600" : p.netProfit > 0 ? "text-green-600" : ""}`}>{short(p.netProfit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-semibold">
                  <tr>
                    <td className="p-2">Total</td>
                    <td className="p-2 text-right font-mono">{short(t.netSales)}</td>
                    <td className="p-2 text-right font-mono">{short(t.grossProfit)}</td>
                    <td className="p-2 text-right font-mono">{short(t.waste + t.expenses + t.payroll)}</td>
                    <td className={`p-2 text-right font-mono ${t.netProfit < 0 ? "text-red-600" : "text-green-600"}`}>{short(t.netProfit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-secondary-500">Amounts in KES. Sales are net of tax and refunds. Profit = gross profit less waste, expenses and payroll.</p>

            {data.expensesByCategory.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-4 text-sm">
                <h2 className="mb-2 font-semibold">Where the expenses went</h2>
                <ul className="space-y-1">
                  {data.expensesByCategory.map((c) => (
                    <li key={c.category} className="flex justify-between gap-2">
                      <span>{c.label}</span>
                      <span className="font-mono">{kes(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="rounded-md bg-secondary-500/10 p-3 text-xs text-secondary-600">
              Cost of goods uses each product&apos;s cost as it is now. Buying stock is not an expense - it is counted when you sell the item. Hotel room income and rent are in their own screens (Rooms, Rentals) and are not in this figure. Don&apos;t record salaries here that you pay through Payroll - those are already included.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "border-t border-border pt-1 font-semibold" : ""}`}>
      <dt>
        {label}
        {hint && <span className="block text-xs font-normal text-secondary-500">{hint}</span>}
      </dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
