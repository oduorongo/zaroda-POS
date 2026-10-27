"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../../../lib/api";
import { getSession } from "../../../../lib/auth";
import { KraReceipt, type KraReceiptData } from "../../../../components/kra-receipt";

interface Side {
  receipt: KraReceiptData | null;
  state: string;
  message: string | null;
}
interface Result {
  sale: Side;
  credit: Side;
}

/** The KRA receipt of a sale (and its credit note) for printing. Opened with ?copy=1 it prints as a COPY, which is counted. */
export default function KraReceiptPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const copy = useSearchParams().get("copy") === "1";
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/login");
      return;
    }
    apiGet<Result>(`/etims/receipts/by-sale/${params.id}${copy ? "?copy=true" : ""}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the receipt."));
  }, [params.id, copy, router]);

  const which = data?.sale.receipt || data?.credit.receipt;
  return (
    <div className="min-h-screen bg-secondary-500/10 p-4 text-foreground print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-md flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/sales/${params.id}`} className="text-sm text-primary-600 hover:underline">Back to the sale</Link>
        <div className="flex gap-3 text-sm">
          {which && <button onClick={() => window.print()} className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700">Print</button>}
          {!copy && which && <Link href={`/sales/${params.id}/kra-receipt?copy=1`} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-500/10">Print a copy</Link>}
        </div>
      </div>
      {error && <p className="mx-auto max-w-md rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {data && (
        <div className="space-y-6">
          {data.sale.receipt ? <KraReceipt r={data.sale.receipt} /> : data.sale.message && <p className="mx-auto max-w-md rounded-md bg-amber-950 p-3 text-sm text-amber-200 print:hidden">{data.sale.message}</p>}
          {data.credit.receipt ? <KraReceipt r={data.credit.receipt} /> : data.credit.message && <p className="mx-auto max-w-md rounded-md bg-amber-950 p-3 text-sm text-amber-200 print:hidden">Credit note: {data.credit.message}</p>}
        </div>
      )}
    </div>
  );
}
