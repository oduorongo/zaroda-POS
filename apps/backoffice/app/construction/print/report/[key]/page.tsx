"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { apiGet } from "../../../../../lib/api";
import { getSession } from "../../../../../lib/auth";
import { CON_BRAND, errorText } from "../../../../../lib/construction";
import { type ConReport, ReportTable } from "../../../../../components/construction/report-table";
import { PoweredByFootnote } from "@zaroda/ui";

/** A report on the letterhead, landscape: print or save as PDF from the browser. */
function ReportPrint() {
  const { key } = useParams<{ key: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [report, setReport] = useState<ConReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    const session = getSession();
    if (!session) return router.replace("/login");
    setOrgName(session.orgName ?? "");
    const q = new URLSearchParams(search.toString());
    q.set("format", "print");
    apiGet<ConReport>(`/construction/reports/${key}?${q}`).then(setReport).catch((e) => setError(errorText(e, "Could not load the report.")));
  }, [key, search, router]);

  if (error) return <p className="p-6 text-red-700">{error}</p>;
  if (!report) return <p className="p-6">Loading...</p>;

  return (
    <div className="min-h-screen bg-white p-4 text-black sm:p-8" style={{ colorScheme: "light" }}>
      <style>{`@media print { body > footer, body > div[role="status"] { display: none !important; } @page { size: A4 landscape; margin: 10mm; } }`}</style>
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <button onClick={() => window.print()} className="rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: CON_BRAND.navy }}>Print / Save as PDF</button>
        </div>
        <header className="flex items-end justify-between gap-4 rounded-t-lg px-5 py-3 text-white" style={{ background: CON_BRAND.navy, borderBottom: `4px solid ${CON_BRAND.gold}` }}>
          <p className="text-lg font-bold">{orgName}</p>
          <p className="text-right text-sm font-bold uppercase tracking-widest" style={{ color: CON_BRAND.gold }}>{report.title}</p>
        </header>
        <p className="border-x border-gray-300 px-5 py-2 text-xs text-gray-600">{report.subtitle}</p>
        <div className="border border-t-0 border-gray-300 p-3">
          <ReportTable report={report} print />
        </div>
        <PoweredByFootnote product="Zaroda Build" />
      </div>
    </div>
  );
}

export default function ReportPrintPage() {
  return (
    <Suspense fallback={<p className="p-6">Loading...</p>}>
      <ReportPrint />
    </Suspense>
  );
}
