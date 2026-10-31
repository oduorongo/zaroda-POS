"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "../../../../../../lib/api";
import { getSession } from "../../../../../../lib/auth";
import { CON_BRAND, errorText } from "../../../../../../lib/construction";

interface IpcLine { id: string; bqItemId?: string; variationId?: string; section?: string; code?: string | null; ref?: string; description: string; unit?: string; qty?: number; rate?: number; qtyToDate?: number; approvedAmount?: number; amountToDate: number }
interface IpcPrint {
  number: number; kind: string; status: string; reverses: number | null; periodEnd: string; notes: string | null;
  certifiedByName: string | null; certifiedRef: string | null; certifiedAt: string | null;
  workToDate: number; variationsToDate: number; materialsOnSite: number; grossToDate: number; retentionRate: number; retentionHeld: number; advanceRecovery: number; previousCertified: number; netDue: number;
  vatRate: number | null; vatAmount: number | null; invoiceTotal: number | null;
  lines: IpcLine[];
  project: { code: string; name: string; contractSum: number; revisedSum: number | null; client: { name: string; kraPin: string | null } | null };
  company: { name: string; phone: string | null; email: string | null; kraPin: string | null } | null;
}

const money = (n: number) => (n < 0 ? `(${(-n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const when = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" }) : "-");

/** Interim Payment Certificate with its valuation schedule; print or save as PDF from the browser. */
export default function IpcPrintPage() {
  const { projectId, valuationId } = useParams<{ projectId: string; valuationId: string }>();
  const router = useRouter();
  const [ipc, setIpc] = useState<IpcPrint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) return router.replace("/login");
    apiGet<IpcPrint>(`/construction/projects/${projectId}/valuations/${valuationId}`).then(setIpc).catch((e) => setError(errorText(e, "Could not load the certificate.")));
  }, [projectId, valuationId, router]);

  if (error) return <p className="p-6 text-red-700">{error}</p>;
  if (!ipc) return <p className="p-6">Loading...</p>;
  const certified = ["CERTIFIED", "PAID"].includes(ipc.status);
  const bq = ipc.lines.filter((l) => l.bqItemId);
  const vos = ipc.lines.filter((l) => l.variationId);
  const summary: [string, number, boolean?][] = [
    ["Measured work to date", ipc.workToDate],
    ["Variations to date", ipc.variationsToDate],
    ["Materials on site", ipc.materialsOnSite],
    ["Gross valuation to date", ipc.grossToDate, true],
    [`Less retention (${ipc.retentionRate}%)`, -ipc.retentionHeld],
    ["Less advance recovered", -ipc.advanceRecovery],
    ["Less previously certified", -ipc.previousCertified],
    ["Amount due on this certificate (excl. VAT)", ipc.netDue, true],
  ];
  if (ipc.vatAmount !== null) summary.push([`VAT ${ipc.vatRate}%`, ipc.vatAmount], ["Total payable", ipc.invoiceTotal ?? ipc.netDue + ipc.vatAmount, true]);

  return (
    <div className="min-h-screen bg-white p-4 text-black sm:p-8" style={{ colorScheme: "light" }}>
      <style>{`@media print { body > footer, body > div[role="status"] { display: none !important; } @page { margin: 12mm; } }`}</style>
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <button onClick={() => window.print()} className="rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: CON_BRAND.navy }}>Print / Save as PDF</button>
        </div>
        <header className="flex items-start justify-between gap-4 rounded-t-lg px-5 py-4 text-white" style={{ background: CON_BRAND.navy, borderBottom: `4px solid ${CON_BRAND.gold}` }}>
          <div>
            <p className="text-xl font-bold">{ipc.company?.name ?? ""}</p>
            <p className="text-xs opacity-80">{[ipc.company?.phone, ipc.company?.email, ipc.company?.kraPin && `KRA PIN ${ipc.company.kraPin}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold uppercase tracking-widest" style={{ color: CON_BRAND.gold }}>{ipc.kind === "REVERSAL" ? "Reversing certificate" : "Interim Payment Certificate"}</p>
            <p className="text-2xl font-bold">No. {ipc.number}</p>
          </div>
        </header>
        {!certified && <p className="bg-red-100 px-5 py-2 text-center text-sm font-bold text-red-800">NOT YET CERTIFIED - {ipc.status} - for checking only</p>}
        {ipc.kind === "REVERSAL" && <p className="bg-amber-100 px-5 py-2 text-center text-sm font-bold text-amber-900">This certificate cancels IPC No. {ipc.reverses}</p>}
        <section className="grid gap-4 border-x border-gray-300 px-5 py-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Project</p>
            <p className="font-semibold">{ipc.project.code} · {ipc.project.name}</p>
            <p>Contract sum KES {money(ipc.project.contractSum)}{ipc.project.revisedSum !== null ? ` · revised KES ${money(ipc.project.revisedSum)}` : ""}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Employer (client)</p>
            <p className="font-semibold">{ipc.project.client?.name ?? "-"}</p>
            {ipc.project.client?.kraPin && <p>KRA PIN {ipc.project.client.kraPin}</p>}
          </div>
          <div><span className="text-gray-500">Valuation up to: </span>{when(ipc.periodEnd)}</div>
          <div><span className="text-gray-500">Certified: </span>{certified ? `${when(ipc.certifiedAt)}${ipc.certifiedRef ? ` · ref ${ipc.certifiedRef}` : ""}` : "-"}</div>
        </section>

        <table className="w-full border border-gray-300 text-sm">
          <tbody>
            {summary.map(([label, value, strong]) => (
              <tr key={label} className={`border-t border-gray-200 ${strong ? "font-bold" : ""}`} style={strong ? { background: "#f3f4f6" } : undefined}>
                <td className="px-3 py-1.5">{label}</td>
                <td className="px-3 py-1.5 text-right">KES {money(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {bq.length > 0 && (
          <>
            <p className="mt-6 text-sm font-bold" style={{ color: CON_BRAND.navy }}>Valuation schedule - measured work</p>
            <table className="mt-1 w-full border border-gray-300 text-xs">
              <thead style={{ background: "#f3f4f6" }}>
                <tr><th className="px-2 py-1 text-left">Item</th><th className="px-2 py-1 text-left">Description</th><th className="px-2 py-1 text-right">BQ qty</th><th className="px-2 py-1 text-right">Rate</th><th className="px-2 py-1 text-right">Qty to date</th><th className="px-2 py-1 text-right">Amount</th></tr>
              </thead>
              <tbody>
                {bq.map((l) => (
                  <tr key={l.id} className="border-t border-gray-200">
                    <td className="px-2 py-1">{l.code}</td><td className="px-2 py-1">{l.description} <span className="text-gray-500">{l.unit}</span></td>
                    <td className="px-2 py-1 text-right">{l.qty?.toLocaleString("en-KE")}</td><td className="px-2 py-1 text-right">{money(l.rate ?? 0)}</td>
                    <td className="px-2 py-1 text-right">{l.qtyToDate?.toLocaleString("en-KE")}</td><td className="px-2 py-1 text-right">{money(l.amountToDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {vos.length > 0 && (
          <>
            <p className="mt-4 text-sm font-bold" style={{ color: CON_BRAND.navy }}>Variations</p>
            <table className="mt-1 w-full border border-gray-300 text-xs">
              <tbody>
                {vos.map((l) => (
                  <tr key={l.id} className="border-t border-gray-200">
                    <td className="px-2 py-1">{l.ref}</td><td className="px-2 py-1">{l.description}</td>
                    <td className="px-2 py-1 text-right text-gray-500">approved {money(l.approvedAmount ?? 0)}</td><td className="px-2 py-1 text-right">{money(l.amountToDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {ipc.notes && <p className="mt-3 text-sm"><span className="text-gray-500">Notes: </span>{ipc.notes}</p>}
        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div><div className="border-t border-gray-400 pt-1">Contractor</div></div>
          <div><div className="border-t border-gray-400 pt-1">Certified by (Quantity Surveyor){ipc.certifiedByName ? `: ${ipc.certifiedByName}` : ""}</div></div>
        </div>
        <p className="mt-8 text-center text-[10px]" style={{ color: CON_BRAND.orange }}>Zaroda Build</p>
      </div>
    </div>
  );
}
