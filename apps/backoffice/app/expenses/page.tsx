"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Category {
  key: string;
  label: string;
}
interface Branch {
  id: string;
  name: string;
}
interface Expense {
  id: string;
  spentOn: string;
  category: string;
  categoryLabel: string;
  description: string | null;
  amount: number;
  paidWith: string | null;
  branchId: string | null;
  branchName: string | null;
}
interface ExpenseList {
  items: Expense[];
  total: number;
  byCategory: { category: string; categoryLabel: string; amount: number }[];
  truncated: boolean;
}

const PAID_WITH = [
  ["CASH", "Cash"],
  ["MPESA", "M-Pesa"],
  ["BANK", "Bank"],
  ["CARD", "Card"],
] as const;

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Nairobi is always UTC+3, so "today" is worked out from that, whatever the device's own clock zone is.
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};
const niceDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";

/** Money spent that is not stock: rent, power, transport, wages... Feeds the Profit & loss screen. */
export default function ExpensesPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<ExpenseList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [spentOn, setSpentOn] = useState(today());
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [paidWith, setPaidWith] = useState("");
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState(false);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const { from, to } = monthBounds(month);
      setData(await apiGet<ExpenseList>(`/expenses?from=${from}&to=${to}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your expenses.");
    }
  }, [month]);

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
    setSessionState(s);
    void Promise.all([apiGet<Category[]>("/expenses/categories"), apiGet<Branch[]>("/branches")])
      .then(([c, b]) => {
        setCategories(c);
        setBranches(b);
      })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  function reset() {
    setEditingId(null);
    setSpentOn(today());
    setCategory("");
    setAmount("");
    setDescription("");
    setPaidWith("");
    setBranchId("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        spentOn,
        category,
        amount: Number(amount),
        description: description.trim() || undefined,
        paidWith: paidWith || undefined,
        branchId: branchId || undefined,
      };
      if (editingId) await apiPatch(`/expenses/${editingId}`, body);
      else await apiPost("/expenses", body);
      setNotice(editingId ? "Expense updated." : "Expense recorded.");
      reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(x: Expense) {
    setEditingId(x.id);
    setSpentOn(x.spentOn);
    setCategory(x.category);
    setAmount(String(x.amount));
    setDescription(x.description ?? "");
    setPaidWith(x.paidWith ?? "");
    setBranchId(x.branchId ?? "");
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(x: Expense) {
    if (!window.confirm(`Delete this ${kes(x.amount)} expense (${x.categoryLabel}, ${niceDay(x.spentOn)})? This changes your profit figures.`)) return;
    setError(null);
    try {
      await apiDelete(`/expenses/${x.id}`);
      setNotice("Expense deleted.");
      if (editingId === x.id) reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete that.");
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Expenses</h1>
          <Link href="/profit" className="text-sm text-primary-600 hover:underline">
            See your profit &rarr;
          </Link>
        </div>
        <p className="text-sm text-secondary-500">
          Write down money the business spent that is not stock: rent, electricity, transport, wages, airtime. We take them off your sales profit on the Profit &amp; loss screen. Do not record buying stock here - that is already counted when you sell it.
        </p>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        {canEdit && (
          <form onSubmit={save} className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">{editingId ? "Change this expense" : "Record an expense"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                What was it for?
                <select required value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                  <option value="">Choose...</option>
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Amount (KES)
                <input required type="number" inputMode="decimal" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
              </label>
              <label className="text-sm">
                Date it was spent
                <input required type="date" max={today()} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className={field} />
              </label>
              <label className="text-sm">
                Paid with <span className="text-secondary-500">(optional)</span>
                <select value={paidWith} onChange={(e) => setPaidWith(e.target.value)} className={field}>
                  <option value="">Not said</option>
                  {PAID_WITH.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {branches.length > 1 && (
                <label className="text-sm">
                  For which branch?
                  <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field}>
                    <option value="">The whole business</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-sm sm:col-span-2">
                Note <span className="text-secondary-500">(optional)</span>
                <input maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. October rent, fuel for the van" className={field} />
              </label>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !category || !amount} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {busy ? "Saving..." : editingId ? "Save changes" : "Record expense"}
              </button>
              {editingId && (
                <button type="button" onClick={reset} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary-500/10">
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="text-sm">
              Month
              <input type="month" max={thisMonth()} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="mt-1 rounded-md border border-border bg-surface p-2 text-sm" />
            </label>
            <div className="text-right">
              <p className="text-xs text-secondary-500">Spent in this month</p>
              <p className="text-2xl font-bold">{kes(data?.total ?? 0)}</p>
            </div>
          </div>

          {data && data.byCategory.length > 0 && (
            <ul className="space-y-1.5 rounded-lg border border-border bg-surface p-3 text-sm">
              {data.byCategory.map((c) => (
                <li key={c.category}>
                  <div className="flex justify-between gap-2">
                    <span>{c.categoryLabel}</span>
                    <span className="font-mono">{kes(c.amount)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-secondary-500/15">
                    <div className="h-1.5 rounded-full bg-primary-600" style={{ width: `${Math.max(2, Math.round((c.amount / (data.total || 1)) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!data && !error && <p className="text-sm text-secondary-500">Loading...</p>}
          {data && data.items.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">Nothing recorded for this month yet.</p>}
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {data?.items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                <div>
                  <p className="font-medium">{x.categoryLabel}</p>
                  <p className="text-xs text-secondary-500">
                    {niceDay(x.spentOn)}
                    {x.branchName ? ` · ${x.branchName}` : ""}
                    {x.paidWith ? ` · ${PAID_WITH.find(([k]) => k === x.paidWith)?.[1] ?? x.paidWith}` : ""}
                  </p>
                  {x.description && <p className="text-xs text-secondary-600">{x.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold">{kes(x.amount)}</span>
                  {canEdit && (
                    <>
                      <button onClick={() => startEdit(x)} className="text-xs text-primary-600 hover:underline">
                        Change
                      </button>
                      <button onClick={() => void remove(x)} className="text-xs text-error-600 hover:underline">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {data?.truncated && <p className="text-xs text-warning-700">Only the latest 1,000 are shown. Pick a shorter period.</p>}
        </section>
      </main>
    </div>
  );
}
