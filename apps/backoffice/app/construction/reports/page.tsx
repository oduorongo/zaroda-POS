"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import { CON_BRAND, conDownload, errorText, isUpgrade } from "../../../lib/construction";
import { ConShell } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, UpgradeCard, inputClass } from "../../../components/construction/ui";
import { type ConReport, ReportTable } from "../../../components/construction/report-table";

interface Entry { key: string; title: string; locked: boolean }
interface ProjectLite { id: string; code: string; name: string }

const HELP: Record<string, string> = {
  cost: "What each project has cost so far against its budget, and the margin on what has been certified.",
  cashflow: "Money in from IPCs and out on wages, subcontractors, materials and plant, month by month.",
  ipc: "Certificates, invoices, payments, withholding and retention per project.",
  materials: "BQ allowance against what was ordered, delivered, used, wasted and is left on site.",
  labour: "Worker-days and labour cost per project, what is paid and what is still owed.",
  compliance: "Every document, licence, permit and NCA card with its expiry date, soonest first.",
  safety: "Incidents, DOSHS reports, toolbox talks, PPE and the lost-time injury rate per project.",
  nca: "Your NCA categories and caps against your biggest open contracts and tenders.",
};

export default function ReportsPage() {
  const [catalog, setCatalog] = useState<Entry[] | null>(null);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [key, setKey] = useState<string>("");
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<ConReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Entry[]>("/construction/reports")
      .then((c) => (setCatalog(c), setKey((k) => k || c[0]?.key || "")))
      .catch((e) => setError(errorText(e, "Could not load the reports.")));
    apiGet<ProjectLite[]>("/construction/projects").then(setProjects).catch(() => undefined);
  }, []);

  const query = useCallback((format?: string) => new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(format ? { format } : {}) }).toString(), [projectId, from, to]);

  useEffect(() => {
    if (!key) return;
    setBusy(true);
    setError(null);
    setUpgrade(null);
    apiGet<ConReport>(`/construction/reports/${key}?${query()}`)
      .then(setReport)
      .catch((e) => (setReport(null), isUpgrade(e) ? setUpgrade(errorText(e, "")) : setError(errorText(e, "Could not run the report."))))
      .finally(() => setBusy(false));
  }, [key, query]);

  const entry = catalog?.find((c) => c.key === key);
  const exportXlsx = () => conDownload(`/construction/reports/${key}?${query("xlsx")}`, `${key}-${new Date().toISOString().slice(0, 10)}.xlsx`).catch((e) => (isUpgrade(e) ? setUpgrade(errorText(e, "")) : setError(errorText(e, "Could not download."))));

  return (
    <ConShell title="Reports">
      <ErrorBox message={error} />
      {catalog && catalog.length === 0 && <p className="text-sm text-secondary-500">Your role has no reports. Ask your Director if you need one.</p>}
      {catalog && catalog.length > 0 && (
        <>
          <div className="flex gap-1 overflow-x-auto pb-1 text-sm">
            {catalog.map((c) => (
              <button key={c.key} type="button" onClick={() => setKey(c.key)} className="whitespace-nowrap rounded-full border px-3 py-1.5" style={key === c.key ? { background: CON_BRAND.navy, color: "white", borderColor: CON_BRAND.navy } : { borderColor: "var(--border, #d1d5db)" }}>
                {c.title}{c.locked ? " 🔒" : ""}
              </button>
            ))}
          </div>
          <Panel>
            <p className="mb-3 text-sm text-secondary-600">{HELP[key]}</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Project">
                <select className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">All my projects</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </Field>
              <Field label="From">
                <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <div className="flex items-end gap-2">
                <button type="button" disabled={!report} onClick={exportXlsx} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: CON_BRAND.navy }}>Excel</button>
                <button type="button" disabled={!report} onClick={() => window.open(`/construction/print/report/${key}?${query()}`, "_blank")} className="rounded-lg border px-3 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ borderColor: CON_BRAND.navy, color: "var(--con-ink)" }}>Print / PDF</button>
              </div>
            </div>
          </Panel>
          {upgrade && <UpgradeCard message={upgrade} />}
          {busy && <p className="text-sm text-secondary-500">Working it out...</p>}
          {report && !busy && (
            <Panel title={report.title}>
              <p className="mb-3 text-xs text-secondary-500">{report.subtitle}</p>
              <ReportTable report={report} />
            </Panel>
          )}
          {entry?.locked && !upgrade && <p className="text-xs text-secondary-500">🔒 needs the Contractor plan or higher.</p>}
        </>
      )}
    </ConShell>
  );
}
