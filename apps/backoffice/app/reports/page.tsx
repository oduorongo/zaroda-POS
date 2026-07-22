"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface ByProductRow {
  variantId: string;
  sku: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  cost: number | null;
  margin: number | null;
}

interface ByBranchRow {
  branchId: string;
  branchName: string;
  saleCount: number;
  revenue: number;
}

interface ByCashierRow {
  orgUserId: string;
  cashierName: string;
  saleCount: number;
  revenue: number;
}

interface ByHourRow {
  hour: number;
  saleCount: number;
  revenue: number;
}

interface WasteByProductRow {
  variantId: string;
  sku: string;
  productName: string;
  quantityWasted: number;
  totalCost: number | null;
  costPartiallyKnown: boolean;
  byReason: Record<"EXPIRED" | "DAMAGED" | "SPOILED" | "OVERPRODUCTION" | "OTHER", number>;
}

type ReportKey =
  | "sales-by-product"
  | "sales-by-branch"
  | "sales-by-cashier"
  | "sales-by-hour"
  | "waste-by-product";

const REPORT_TABS: { key: ReportKey; label: string }[] = [
  { key: "sales-by-product", label: "By product" },
  { key: "sales-by-branch", label: "By branch" },
  { key: "sales-by-cashier", label: "By cashier" },
  { key: "sales-by-hour", label: "By hour" },
  { key: "waste-by-product", label: "Waste" },
];

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Read-only - all four endpoints are GET /reports/... with the same
 * ReportFiltersDto (branchId/from/to), restricted server-side to
 * SUPERVISOR+/AUDITOR (see reports.controller.ts). No branchId filter
 * here: no GET /branches (or any branch-listing) endpoint exists
 * anywhere in the API to populate a dropdown from - a real gap, not
 * worked around by hardcoding IDs or a free-text field masquerading as
 * a picker.
 */
export default function ReportsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [tab, setTab] = useState<ReportKey>("sales-by-product");
  const [from, setFrom] = useState(() => toDateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toDateInput(new Date()));

  const [byProduct, setByProduct] = useState<ByProductRow[]>([]);
  const [byBranch, setByBranch] = useState<ByBranchRow[]>([]);
  const [byCashier, setByCashier] = useState<ByCashierRow[]>([]);
  const [byHour, setByHour] = useState<ByHourRow[]>([]);
  const [byWaste, setByWaste] = useState<WasteByProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!session) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, from, to]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    // `to` is exclusive (ReportFiltersDto's comment) - push it to the end
    // of the selected day so a same-day range isn't empty.
    const query = `?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`;
    try {
      const [productResult, branchResult, cashierResult, hourResult, wasteResult] = await Promise.all([
        apiGet<ByProductRow[]>(`/reports/sales-by-product${query}`),
        apiGet<ByBranchRow[]>(`/reports/sales-by-branch${query}`),
        apiGet<ByCashierRow[]>(`/reports/sales-by-cashier${query}`),
        apiGet<ByHourRow[]>(`/reports/sales-by-hour${query}`),
        apiGet<WasteByProductRow[]>(`/reports/waste-by-product${query}`),
      ]);
      setByProduct(productResult);
      setByBranch(branchResult);
      setByCashier(cashierResult);
      setByHour(hourResult);
      setByWaste(wasteResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }

  const totalRevenue = useMemo(() => byBranch.reduce((sum, r) => sum + r.revenue, 0), [byBranch]);
  const totalWasteCost = useMemo(
    () => byWaste.reduce((sum, r) => sum + (r.totalCost ?? 0), 0),
    [byWaste],
  );

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-xl font-bold">Reports</h1>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-400">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
            />
          </div>
          {!loading && (
            <p className="pb-2 text-sm text-slate-400">
              Total revenue: KES {totalRevenue.toFixed(2)}
              {byWaste.length > 0 && <span className="ml-3 text-red-400">Waste cost: KES {totalWasteCost.toFixed(2)}</span>}
            </p>
          )}
        </div>

        <div className="mb-4 flex gap-2">
          {REPORT_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === t.key ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}

        {!loading && tab === "sales-by-product" && (
          <ReportTable
            columns={["Product", "SKU", "Qty sold", "Revenue (KES)", "Margin (KES)"]}
            rows={byProduct.map((r) => [
              r.productName,
              r.sku,
              String(r.quantitySold),
              r.revenue.toFixed(2),
              r.margin === null ? "—" : r.margin.toFixed(2),
            ])}
            emptyMessage="No completed sales in this range."
          />
        )}
        {!loading && tab === "sales-by-branch" && (
          <ReportTable
            columns={["Branch", "Sales", "Revenue (KES)"]}
            rows={byBranch.map((r) => [r.branchName, String(r.saleCount), r.revenue.toFixed(2)])}
            emptyMessage="No completed sales in this range."
          />
        )}
        {!loading && tab === "sales-by-cashier" && (
          <ReportTable
            columns={["Cashier", "Sales", "Revenue (KES)"]}
            rows={byCashier.map((r) => [r.cashierName, String(r.saleCount), r.revenue.toFixed(2)])}
            emptyMessage="No completed sales in this range."
          />
        )}
        {!loading && tab === "sales-by-hour" && (
          <ReportTable
            columns={["Hour (EAT)", "Sales", "Revenue (KES)"]}
            rows={byHour
              .filter((r) => r.saleCount > 0)
              .map((r) => [`${String(r.hour).padStart(2, "0")}:00`, String(r.saleCount), r.revenue.toFixed(2)])}
            emptyMessage="No completed sales in this range."
          />
        )}
        {!loading && tab === "waste-by-product" && (
          <ReportTable
            columns={["Product", "SKU", "Qty wasted", "Cost (KES)", "Top reason"]}
            rows={byWaste.map((r) => {
              const topReason = (Object.entries(r.byReason) as [string, number][])
                .sort((a, b) => b[1] - a[1])
                .find(([, qty]) => qty > 0)?.[0];
              return [
                r.productName,
                r.sku,
                String(r.quantityWasted),
                r.totalCost === null ? "—" : `${r.totalCost.toFixed(2)}${r.costPartiallyKnown ? "*" : ""}`,
                topReason ?? "—",
              ];
            })}
            emptyMessage="No write-offs in this range."
          />
        )}
        {!loading && tab === "waste-by-product" && byWaste.some((r) => r.costPartiallyKnown) && (
          <p className="mt-2 text-xs text-slate-500">* some entries for this product have no known cost - total is a partial figure.</p>
        )}
      </main>
    </div>
  );
}

function ReportTable({ columns, rows, emptyMessage }: { columns: string[]; rows: string[][]; emptyMessage: string }) {
  if (rows.length === 0) return <p className="text-slate-400">{emptyMessage}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-800 text-slate-400">
          <tr>
            {columns.map((c) => (
              <th key={c} className="p-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-800">
              {row.map((cell, j) => (
                <td key={j} className={`p-3 ${j > 0 ? "text-right font-mono" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
