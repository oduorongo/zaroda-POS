"use client";

import { DeliveryNoteDocument, InvoiceDocument, ReceiptDocument, StatementDocument, type DocInvoice, type DocOrder, type DocReceipt, type DocStatement } from "@zaroda/ui";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "../../../../../../lib/api";
import { schoolInvoiceDoc, schoolOrderDoc, schoolReceiptDoc, schoolStatement } from "../../../../../../lib/school-api";

/** A plain white page meant for the printer (or "save as PDF"): the school's own invoice, delivery note, receipt or statement. */
export default function SchoolPrintPage() {
  const { slug, kind, id } = useParams<{ slug: string; kind: string; id: string }>();
  const [invoice, setInvoice] = useState<DocInvoice | null>(null);
  const [order, setOrder] = useState<DocOrder | null>(null);
  const [receipt, setReceipt] = useState<DocReceipt | null>(null);
  const [statement, setStatement] = useState<DocStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = window.localStorage.getItem(`zaroda_school_token_${slug}`);
    } catch {
      token = null;
    }
    if (!token) {
      setError("Please sign in on the ordering page first, then open this again.");
      return;
    }
    const load =
      kind === "invoice"
        ? schoolInvoiceDoc(token, id).then(setInvoice)
        : kind === "delivery-note"
          ? schoolOrderDoc(token, id).then(setOrder)
          : kind === "receipt"
            ? schoolReceiptDoc(token, id).then(setReceipt)
            : schoolStatement(token).then(setStatement);
    load.catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this page."));
  }, [slug, kind, id]);

  return (
    <div className="min-h-screen bg-white p-6 text-black print:min-h-0 print:p-0">
      <style>{`@media print { header, footer, nav { display: none !important; } @page { margin: 12mm; } }`}</style>
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
