"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DeliveryNoteDocument, InvoiceDocument, ReceiptDocument, StatementDocument, type DocInvoice, type DocOrder, type DocReceipt, type DocStatement } from "@zaroda/ui";
import { apiGet, ApiError } from "../../../../lib/api";
import { getSession } from "../../../../lib/auth";

/** A plain white page meant for the printer (or "save as PDF"): an invoice, delivery note, receipt or statement for a school. */
export default function SchoolPrintPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const [invoice, setInvoice] = useState<DocInvoice | null>(null);
  const [order, setOrder] = useState<DocOrder | null>(null);
  const [receipt, setReceipt] = useState<DocReceipt | null>(null);
  const [statement, setStatement] = useState<DocStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/login");
      return;
    }
    const query = new URLSearchParams();
    for (const key of ["from", "to"]) {
      const value = search.get(key);
      if (value) query.set(key, value);
    }
    const load =
      kind === "invoice"
        ? apiGet<DocInvoice>(`/school-supplier/invoices/${id}`).then(setInvoice)
        : kind === "delivery-note"
          ? apiGet<DocOrder>(`/school-supplier/orders/${id}`).then(setOrder)
          : kind === "receipt"
            ? apiGet<DocReceipt>(`/school-supplier/payments/${id}`).then(setReceipt)
            : apiGet<DocStatement>(`/school-supplier/schools/${id}/statement?${query.toString()}`).then(setStatement);
    load.catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this page."));
  }, [kind, id, router, search]);

  return (
    <div className="min-h-screen bg-white p-6 text-black print:min-h-0 print:p-0">
      <style>{`@media print { body > footer { display: none !important; } @page { margin: 12mm; } }`}</style>
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <button onClick={() => window.print()} className="rounded-md bg-blue-700 px-3 py-2 text-sm text-white">
            Print / save as PDF
          </button>
        </div>
        {error && <p className="text-red-700">{error}</p>}
        {invoice && <InvoiceDocument invoice={invoice} />}
        {order && <DeliveryNoteDocument order={order} />}
        {receipt && <ReceiptDocument receipt={receipt} />}
        {statement && <StatementDocument statement={statement} />}
      </div>
    </div>
  );
}
