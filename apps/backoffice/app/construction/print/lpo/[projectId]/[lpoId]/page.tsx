"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "../../../../../../lib/api";
import { getSession } from "../../../../../../lib/auth";
import { CON_BRAND, errorText } from "../../../../../../lib/construction";

interface LpoPrint {
  number: string; status: string; total: number; deliverBy: string | null; createdAt: string; approvedAt: string | null; notes: string | null;
  supplier: { name: string; phone: string | null; email: string | null };
  project: { code: string; name: string; location: string | null; county: string | null };
  company: { name: string; phone: string | null; email: string | null; kraPin: string | null } | null;
  requisition: { number: string } | null;
  lines: { name: string; unit: string; qty: number; rate: number; amount: number }[];
}

const money = (n: number) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" }) : "-");

/** The LPO as the supplier sees it: letterhead in the brand colours, print or save as PDF from the browser. */
export default function LpoPrintPage() {
  const { projectId, lpoId } = useParams<{ projectId: string; lpoId: string }>();
  const router = useRouter();
  const [lpo, setLpo] = useState<LpoPrint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) return router.replace("/login");
    apiGet<LpoPrint>(`/construction/projects/${projectId}/lpos/${lpoId}`).then(setLpo).catch((e) => setError(errorText(e, "Could not load the LPO.")));
  }, [projectId, lpoId, router]);

  if (error) return <p className="p-6 text-red-700">{error}</p>;
  if (!lpo) return <p className="p-6">Loading...</p>;
  const approved = !["AWAITING_APPROVAL", "REJECTED", "CANCELLED"].includes(lpo.status);

  return (
    <div className="min-h-screen bg-white p-4 text-black sm:p-8" style={{ colorScheme: "light" }}>
      <style>{`@media print { body > footer, body > div[role="status"] { display: none !important; } @page { margin: 12mm; } }`}</style>
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <button onClick={() => window.print()} className="rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: CON_BRAND.navy }}>Print / Save as PDF</button>
        </div>
        <header className="flex items-start justify-between gap-4 rounded-t-lg px-5 py-4 text-white" style={{ background: CON_BRAND.navy, borderBottom: `4px solid ${CON_BRAND.gold}` }}>
          <div>
            <p className="text-xl font-bold">{lpo.company?.name ?? ""}</p>
            <p className="text-xs opacity-80">{[lpo.company?.phone, lpo.company?.email, lpo.company?.kraPin && `KRA PIN ${lpo.company.kraPin}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold uppercase tracking-widest" style={{ color: CON_BRAND.gold }}>Local Purchase Order</p>
            <p className="text-2xl font-bold">{lpo.number}</p>
          </div>
        </header>
        {!approved && <p className="bg-red-100 px-5 py-2 text-center text-sm font-bold text-red-800">NOT APPROVED - {lpo.status.replace(/_/g, " ")} - do not supply against this copy</p>}
        <section className="grid gap-4 border-x border-gray-300 px-5 py-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">To (supplier)</p>
            <p className="font-semibold">{lpo.supplier.name}</p>
            <p>{[lpo.supplier.phone, lpo.supplier.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Deliver to</p>
            <p className="font-semibold">{lpo.project.code} · {lpo.project.name}</p>
            <p>{[lpo.project.location, lpo.project.county].filter(Boolean).join(", ")}</p>
          </div>
          <div><span className="text-gray-500">Date: </span>{when(lpo.approvedAt ?? lpo.createdAt)}</div>
          <div><span className="text-gray-500">Deliver by: </span>{when(lpo.deliverBy)}{lpo.requisition ? <span className="text-gray-500"> · Ref {lpo.requisition.number}</span> : null}</div>
        </section>
        <table className="w-full border border-gray-300 text-sm">
          <thead style={{ background: "#f3f4f6" }}>
            <tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-left">Unit</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Rate (KES)</th><th className="px-3 py-2 text-right">Amount (KES)</th></tr>
          </thead>
          <tbody>
            {lpo.lines.map((l, i) => (
              <tr key={i} className="border-t border-gray-200">
                <td className="px-3 py-1.5">{i + 1}</td><td className="px-3 py-1.5">{l.name}</td><td className="px-3 py-1.5">{l.unit}</td>
                <td className="px-3 py-1.5 text-right">{l.qty.toLocaleString("en-KE")}</td><td className="px-3 py-1.5 text-right">{money(l.rate)}</td><td className="px-3 py-1.5 text-right">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2" style={{ borderColor: CON_BRAND.navy }}>
              <td colSpan={5} className="px-3 py-2 text-right font-bold">Total</td>
              <td className="px-3 py-2 text-right font-bold">{money(lpo.total)}</td>
            </tr>
          </tfoot>
        </table>
        {lpo.notes && <p className="mt-3 text-sm"><span className="text-gray-500">Notes: </span>{lpo.notes}</p>}
        <p className="mt-3 text-xs text-gray-600">Quote this LPO number on your delivery note and invoice. Goods are received only against an approved LPO; prices include VAT where applicable.</p>
        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div><div className="border-t border-gray-400 pt-1">Authorised by</div></div>
          <div><div className="border-t border-gray-400 pt-1">Supplier&apos;s acceptance</div></div>
        </div>
        <p className="mt-8 text-center text-[10px] text-gray-400" style={{ color: CON_BRAND.orange }}>Zaroda Build</p>
      </div>
    </div>
  );
}
