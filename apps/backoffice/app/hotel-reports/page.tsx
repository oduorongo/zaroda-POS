"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { downloadCsv } from "../../lib/csv-download";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { addDays, field, ghostBtn, primaryBtn, today } from "../front-desk/types";

type Name = "occupancy" | "revenue" | "arrivals" | "departures" | "in-house" | "balances" | "cancellations";

interface Report {
  name: Name;
  title: string;
  from: string;
  to: string;
  columns: string[];
  rows: (string | number | null)[][];
  figures: { label: string; value: string | number }[];
}

const TABS: { name: Name; label: string; range: boolean }[] = [
  { name: "occupancy", label: "Occupancy", range: true },
  { name: "revenue", label: "Revenue by source", range: true },
  { name: "arrivals", label: "Arrivals", range: false },
  { name: "departures", label: "Departures", range: false },
  { name: "in-house", label: "In house", range: false },
  { name: "balances", label: "Owing", range: false },
  { name: "cancellations", label: "Cancellations & no-shows", range: true },
];

const cell = (v: string | number | null) => (v === null ? "" : typeof v === "number" ? v.toLocaleString("en-KE", { maximumFractionDigits: 2 }) : v);

/** The hotel's reports: how full it was, what it earned and from where, who comes and goes, who owes, who cancelled. Each downloads as CSV. */
export default function HotelReportsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Name>("occupancy");
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const [date, setDate] = useState(today());
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = TABS.find((t) => t.name === tab)!;

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    if (s.industryType !== "HOTEL" && s.industryType !== "RESTAURANT") return void router.replace("/sales");
    setSession(s);
  }, [router]);

  const query = useCallback(() => (current.range ? `from=${from}&to=${to}` : tab === "balances" ? "" : `date=${date}`), [current.range, from, to, date, tab]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    setBusy(true);
    apiGet<Report>(`/hotel/reports/${tab}?${query()}`)
      .then((r) => live && (setReport(r), setError(null)))
      .catch((e) => live && (setReport(null), setError(e instanceof ApiError ? e.message : "Could not load the report.")))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [session, tab, query]);

  async function download() {
    try {
      const r = await apiGet<{ filename: string; csv: string }>(`/hotel/reports/${tab}?${query()}${query() ? "&" : ""}format=csv`);
      downloadCsv(r.filename, r.csv);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not make the file.");
    }
  }

  if (!session) return null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-6xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Hotel reports</h1>
          <Link href="/front-desk" className={ghostBtn}>Back to the front desk</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.name} onClick={() => setTab(t.name)} className={`rounded-md border px-3 py-1.5 text-sm ${t.name === tab ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>{t.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {current.range ? (
            <>
              <label className="text-sm">From<input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="text-sm">To<input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </>
          ) : tab !== "balances" ? (
            <label className="text-sm">Day<input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          ) : null}
          <button className={primaryBtn} disabled={!report} onClick={() => void download()}>Download CSV</button>
        </div>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {busy && <p className="text-sm text-secondary-500">Loading...</p>}
        {report && (
          <>
            <div className="flex flex-wrap gap-3">
              {report.figures.map((f) => (
                <div key={f.label} className="rounded-lg border border-border bg-surface px-4 py-2">
                  <p className="text-xs text-secondary-500">{f.label}</p>
                  <p className="text-lg font-bold">{cell(f.value)}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-secondary-500">
                    {report.columns.map((c) => <th key={c} className="whitespace-nowrap p-2">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {r.map((v, j) => <td key={j} className="whitespace-nowrap p-2">{cell(v)}</td>)}
                    </tr>
                  ))}
                  {report.rows.length === 0 && <tr><td className="p-3 text-secondary-500" colSpan={report.columns.length}>Nothing to show for this.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
