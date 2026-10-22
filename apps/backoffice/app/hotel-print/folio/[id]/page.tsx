"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, ApiError } from "../../../../lib/api";
import { getSession } from "../../../../lib/auth";
import { kes, METHOD_LABEL, type Folio } from "../../../front-desk/types";

/** A plain white page for the printer (or "save as PDF"): the guest's folio, with the hotel's details and KRA PIN. */
export default function PrintFolioPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [folio, setFolio] = useState<Folio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) return void router.replace("/login");
    apiGet<Folio>(`/hotel/bookings/${id}/folio`).then(setFolio).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this page."));
  }, [id, router]);

  const b = folio?.booking;
  const biz = folio?.business;
  return (
    <div className="min-h-screen bg-white p-6 text-black print:min-h-0 print:p-0">
      <style>{`@media print { body > footer { display: none !important; } @page { margin: 12mm; } }`}</style>
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex justify-end print:hidden">
          <button onClick={() => window.print()} className="rounded-md bg-blue-700 px-3 py-2 text-sm text-white">Print / save as PDF</button>
        </div>
        {error && <p className="text-red-700">{error}</p>}
        {folio && b && (
          <div className="rounded border border-gray-400 p-6">
            <div className="flex items-start justify-between border-b border-gray-400 pb-3">
              <div>
                <h1 className="text-xl font-bold">{biz?.name}</h1>
                {biz?.address && <p className="text-sm text-gray-700">{biz.address}</p>}
                <p className="text-sm text-gray-700">{[biz?.phone, biz?.email].filter(Boolean).join(" · ")}</p>
                {biz?.kraPin && <p className="text-sm text-gray-700">KRA PIN: {biz.kraPin}</p>}
              </div>
              <div className="text-right">
                <p className="text-lg font-bold uppercase">Guest folio</p>
                <p className="font-mono text-sm">{b.bookingNumber}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs uppercase text-gray-500">Guest</p>
                <p className="font-semibold">{b.guestName}</p>
                <p>{b.guestPhone}</p>
              </div>
              <div>
                <p>{b.roomTypeName}{b.roomNumbers.length > 0 ? ` - Room ${b.roomNumbers.join(", ")}` : ""}</p>
                <p>{b.checkIn} to {b.checkOut} ({b.nights} night{b.nights === 1 ? "" : "s"})</p>
              </div>
            </div>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600"><th className="py-1">Details</th><th className="py-1 text-right">Amount (KES)</th></tr>
              </thead>
              <tbody>
                {folio.entries.map((e) => (
                  <tr key={e.id} className="border-b border-gray-200">
                    <td className="py-1">
                      {e.description}
                      {e.method ? ` (${METHOD_LABEL[e.method] ?? e.method}${e.reference ? ` ${e.reference}` : ""})` : ""}
                    </td>
                    <td className="py-1 text-right">{e.type === "PAYMENT" ? "-" : ""}{kes(e.amount).replace("KES ", "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="ml-auto mt-3 text-sm">
              <tbody>
                <tr><td className="pr-6 text-gray-600">Room charges</td><td className="text-right">{kes(folio.totals.roomNights).replace("KES ", "")}</td></tr>
                <tr><td className="pr-6 text-gray-600">of which VAT / levies</td><td className="text-right">{kes(folio.totals.roomTax).replace("KES ", "")}</td></tr>
                {folio.totals.charges > 0 && <tr><td className="pr-6 text-gray-600">Charged to the room</td><td className="text-right">{kes(folio.totals.charges).replace("KES ", "")}</td></tr>}
                {folio.totals.adjustments !== 0 && <tr><td className="pr-6 text-gray-600">Adjustments</td><td className="text-right">{kes(folio.totals.adjustments).replace("KES ", "")}</td></tr>}
                <tr><td className="pr-6 text-gray-600">Paid</td><td className="text-right">{kes(folio.totals.payments - folio.totals.refunds).replace("KES ", "")}</td></tr>
                <tr className="text-base font-bold"><td className="pr-6">{folio.totals.balance >= 0 ? "Balance due" : "Owed to guest"}</td><td className="text-right">{kes(Math.abs(folio.totals.balance)).replace("KES ", "")}</td></tr>
              </tbody>
            </table>
            {biz?.invoiceFooter && <p className="mt-4 text-xs text-gray-700">{biz.invoiceFooter}</p>}
            <div className="mt-8 border-t border-gray-300 pt-3 text-center text-[10px] italic text-gray-500">
              <p>This is a computer-generated document. Printed {folio.printedOn.slice(0, 10)}.</p>
              <p>Powered by ZARODA SOLUTIONS</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
