"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { PageHeader } from "../../../components/page-header";

type MenuClass = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG";

interface Dish {
  variantId: string;
  name: string;
  quantity: number;
  revenue: number;
  mixPct: number;
  avgPrice: number;
  unitCost: number | null;
  unitMargin: number | null;
  totalMargin: number | null;
  menuClass: MenuClass | null;
}

interface Result {
  dishes: Dish[];
  totalPlates: number;
  popularAtPct: number;
  avgMargin: number | null;
  summary: Record<MenuClass | "NO_COST", number>;
  categories: { id: string; name: string }[];
}

const BOXES: { key: MenuClass; label: string; what: string; advice: string; tone: string }[] = [
  { key: "STAR", label: "Stars", what: "Sell a lot, earn a lot", advice: "Keep them as they are and give them the best place on the menu.", tone: "bg-[#d4af37] text-[#0f1f45]" },
  { key: "PLOWHORSE", label: "Plowhorses", what: "Sell a lot, earn little", advice: "Raise the price a little, or make the portion or recipe cheaper.", tone: "bg-primary-600 text-white" },
  { key: "PUZZLE", label: "Puzzles", what: "Earn a lot, sell little", advice: "Move them up the menu, rename them, or have staff suggest them.", tone: "bg-accent-500 text-white" },
  { key: "DOG", label: "Dogs", what: "Sell little, earn little", advice: "Change them or take them off the menu.", tone: "bg-secondary-500 text-white" },
];
const box = (c: MenuClass | null) => BOXES.find((b) => b.key === c);
const kes = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Which dishes make money: each item sold is placed as a star, plowhorse, puzzle or dog, with what to do about it. */
export default function MenuEngineeringPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => day(new Date()));
  const [categoryId, setCategoryId] = useState("");
  const [recipesOnly, setRecipesOnly] = useState(true);
  const [data, setData] = useState<Result | null>(null);
  const [filter, setFilter] = useState<MenuClass | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (!session) return;
    const q = new URLSearchParams({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z`, recipesOnly: recipesOnly ? "1" : "0" });
    if (categoryId) q.set("categoryId", categoryId);
    apiGet<Result>(`/reports/menu-engineering?${q}`)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this."));
  }, [session, from, to, categoryId, recipesOnly]);

  if (!session) return null;
  const rows = data?.dishes.filter((d) => !filter || d.menuClass === filter) ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Menu engineering</h1>
          <Link href="/reports" className="text-sm text-primary-600 hover:underline">All reports</Link>
        </div>
        <p className="text-sm text-secondary-500">
          Which dishes actually make money. Each dish is compared with the others on how often it sells and how much it earns per plate (price before tax, less what its recipe costs). Set a cost on every ingredient (Products) so no dish is left out.
        </p>

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>
            <span className="block text-xs text-secondary-500">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-border bg-surface p-2" />
          </label>
          <label>
            <span className="block text-xs text-secondary-500">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-border bg-surface p-2" />
          </label>
          <label>
            <span className="block text-xs text-secondary-500">Category</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-md border border-border bg-surface p-2">
              <option value="">All categories</option>
              {data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={recipesOnly} onChange={(e) => setRecipesOnly(e.target.checked)} />
            Only dishes made from a recipe
          </label>
        </div>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {BOXES.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setFilter(filter === b.key ? null : b.key)}
                  className={`rounded-xl p-3 text-left ${b.tone} ${filter && filter !== b.key ? "opacity-50" : ""}`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{b.label}</span>
                    <span className="text-2xl font-bold">{data.summary[b.key]}</span>
                  </div>
                  <p className="text-xs font-medium">{b.what}</p>
                  <p className="mt-1 text-xs opacity-90">{b.advice}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-secondary-500">
              {data.totalPlates.toLocaleString()} sold. Popular means at least {data.popularAtPct}% of all sold; the average earned per plate is KES {kes(data.avgMargin)}.
              {data.summary.NO_COST > 0 && ` ${data.summary.NO_COST} item(s) have no cost set and are not placed.`}
              {filter && " Tap the box again to show every dish."}
            </p>

            {rows.length === 0 ? (
              <p className="text-sm text-secondary-500">Nothing sold in this period{recipesOnly ? " from a recipe" : ""}.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-left text-xs text-secondary-500">
                    <tr>
                      <th className="p-2">Dish</th>
                      <th className="p-2 text-right">Sold</th>
                      <th className="p-2 text-right">Share</th>
                      <th className="p-2 text-right">Price</th>
                      <th className="p-2 text-right">Cost</th>
                      <th className="p-2 text-right">Earns / plate</th>
                      <th className="p-2 text-right">Earned</th>
                      <th className="p-2">Box</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => {
                      const b = box(d.menuClass);
                      return (
                        <tr key={d.variantId} className="border-t border-border">
                          <td className="p-2">{d.name}</td>
                          <td className="p-2 text-right">{d.quantity.toLocaleString()}</td>
                          <td className="p-2 text-right">{d.mixPct}%</td>
                          <td className="p-2 text-right">{kes(d.avgPrice)}</td>
                          <td className="p-2 text-right">{kes(d.unitCost)}</td>
                          <td className="p-2 text-right">{kes(d.unitMargin)}</td>
                          <td className="p-2 text-right">{kes(d.totalMargin)}</td>
                          <td className="p-2">
                            {b ? <span className={`rounded px-1.5 py-0.5 text-xs ${b.tone}`}>{b.label.slice(0, -1)}</span> : <span className="text-xs text-secondary-500">Set a cost</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
