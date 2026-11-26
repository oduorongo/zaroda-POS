"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../../../lib/api";
import { getSession } from "../../../lib/auth";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { SHAMBA_BRAND, inputClass, todayKey } from "../../../lib/shamba";
import { downloadPdf, fromReport, printPdf } from "../../../lib/pdf";

interface Entry { key: string; title: string; period: boolean; allowed: boolean }
type Cell = string | number | null;
interface Report { key: string; title: string; subtitle: string; columns: { key: string; label: string; type?: "text" | "money" | "number" | "date" }[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell>; notes?: string[] }

const minus = (days: number) => new Date(Date.now() + 3 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10);
const show = (v: Cell, type?: string) => (v === null || v === undefined || v === "" ? "-" : typeof v === "number" && (type === "money" || type === "number") ? v.toLocaleString("en-KE", { maximumFractionDigits: 2 }) : String(v));

/** The Excel file, fetched with the session (a plain link would not carry it). */
async function download(path: string, name: string) {
  const s = getSession();
  if (!s) throw new ApiError("Not logged in", 401);
  const res = await fetch(`${s.apiBaseUrl.replace(/\/+$/, "")}${path}`, { headers: { Authorization: `Bearer ${s.accessToken}` } });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(j.message ?? `Download failed (${res.status})`, res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function ReportsPage() {
  const [catalog, setCatalog] = useState<Entry[]>([]);
  const [key, setKey] = useState("enterprises");
  const [from, setFrom] = useState(minus(29));
  const [to, setTo] = useState(todayKey());
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [busy, setBusy] = useState(false);
  const entry = catalog.find((c) => c.key === key);
  const query = (extra = "") => `/farm/reports/${key}?from=${from}&to=${to}${extra}`;

  useEffect(() => {
    apiGet<Entry[]>("/farm/reports").then(setCatalog).catch((err) => setError(errText(err, "Could not load the reports")));
  }, []);
  useEffect(() => {
    setError(null);
    setUpgrade(false);
    setReport(null);
    apiGet<Report>(query())
      .then(setReport)
      .catch((err) => {
        setUpgrade(err instanceof ApiError && err.status === 402);
        setError(errText(err, "Could not load the report"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, from, to]);

  async function excel() {
    setBusy(true);
    setError(null);
    try {
      await download(query("&format=xlsx"), `farm-${key}-${to}.xlsx`);
    } catch (err) {
      setUpgrade(err instanceof ApiError && err.status === 402);
      setError(errText(err, "Could not download"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShambaAppFrame>
      {() => (
        <div className="space-y-4">
          <div className="print:hidden">
            <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Reports</h1>
            <p className="text-sm text-secondary-600">Profit per enterprise, what each litre, egg, kg and acre costs, and the registers inspectors and buyers ask for. Download to Excel or print to PDF.</p>
          </div>
          <Card>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 print:hidden">
              <label className="col-span-2">
                Report
                <select className={inputClass} value={key} onChange={(e) => setKey(e.target.value)}>
                  {catalog.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.title}
                      {c.allowed ? "" : " (upgrade)"}
                    </option>
                  ))}
                </select>
              </label>
              {entry?.period !== false && (
                <>
                  <label>
                    From
                    <input type="date" className={inputClass} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
                  </label>
                  <label>
                    To
                    <input type="date" className={inputClass} value={to} max={todayKey()} onChange={(e) => setTo(e.target.value)} />
                  </label>
                </>
              )}
              <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-4">
                <Btn type="button" busy={busy} disabled={!report} onClick={() => void excel()}>
                  Download Excel
                </Btn>
                <Btn type="button" tone="navy" disabled={!report} onClick={() => report && void downloadPdf(fromReport(report), `${report.title} ${report.subtitle}`)}>
                  Download PDF
                </Btn>
                <Btn type="button" disabled={!report} onClick={() => report && void printPdf(fromReport(report))}>
                  Print
                </Btn>
              </div>
            </div>
            <ErrorBox error={error} />
            {upgrade && (
              <Link href="/shamba/pricing" className="text-sm font-semibold underline print:hidden" style={{ color: SHAMBA_BRAND.orange }}>
                See plans
              </Link>
            )}
          </Card>

          {report && (
            <Card>
              <h2 className="text-lg font-bold" style={{ color: SHAMBA_BRAND.navy }}>{report.title}</h2>
              <p className="mb-3 text-sm text-secondary-600">{report.subtitle}</p>
              {report.rows.length === 0 ? (
                <p className="text-sm text-secondary-500">Nothing to show for this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-secondary-500">
                        {report.columns.map((c) => (
                          <th key={c.key} className={`py-1 pr-3 ${c.type === "money" || c.type === "number" ? "text-right" : ""}`}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((r, i) => (
                        <tr key={i} className="border-t border-secondary-100">
                          {report.columns.map((c) => (
                            <td key={c.key} className={`py-1.5 pr-3 ${c.type === "money" || c.type === "number" ? "text-right tabular-nums" : ""}`}>
                              {show(r[c.key], c.type)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {report.totals && (
                        <tr className="border-t-2 border-secondary-300 font-bold">
                          {report.columns.map((c) => (
                            <td key={c.key} className={`py-1.5 pr-3 ${c.type === "money" || c.type === "number" ? "text-right tabular-nums" : ""}`}>
                              {report.totals![c.key] === undefined ? "" : show(report.totals![c.key], c.type)}
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {report.notes?.map((n) => (
                <p key={n} className="mt-3 text-xs text-secondary-500">
                  {n}
                </p>
              ))}
            </Card>
          )}
        </div>
      )}
    </ShambaAppFrame>
  );
}
