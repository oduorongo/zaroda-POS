"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../../lib/api";
import { getSession, clearSession, isBackofficeRole } from "../../../lib/auth";

interface Receipt {
  id: string;
  receiptNumber: string;
  createdAt: string;
  deliveryNote: string | null;
  notes: string | null;
  branch: { name: string };
  supplier: { name: string } | null;
  purchaseOrder: { id: string; reference: string | null } | null;
  bills: { id: string; billNumber: string; total: number; status: string }[];
  lines: { id: string; sku: string; name: string; quantityAccepted: number; quantityDamaged: number; damagedNote: string | null; unitCost: number | null; value: number | null }[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One goods-received note on a plain white page for the printer (or "save as PDF"). */
export default function GoodsReceiptPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    apiGet<Receipt>(`/goods-receipts/${id}`).then(setR).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this note."));
  }, [id, router]);

  const total = r && r.lines.every((l) => l.value !== null) ? r.lines.reduce((s, l) => s + (l.value ?? 0), 0) : null;
  return (
    <div className="min-h-screen bg-white p-6 text-black print:min-h-0 print:p-0">
      <style>{`@media print { body > footer { display: none !important; } @page { margin: 12mm; } }`}</style>
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-between print:hidden">
          <Link href="/goods-receipts" className="text-sm text-blue-700 hover:underline">&larr; All goods received</Link>
          <button onClick={() => window.print()} className="rounded-md bg-blue-700 px-3 py-2 text-sm text-white">Print / save as PDF</button>
        </div>
        {error && <p className="text-red-700">{error}</p>}
        {r && (
          <div className="rounded border border-gray-400 p-6">
            <div className="flex items-start justify-between border-b border-gray-400 pb-3">
              <div>
                <p className="text-lg font-bold uppercase">Goods received note</p>
                <p className="font-mono text-sm">{r.receiptNumber}</p>
              </div>
              <div className="text-right text-sm">
                <p>{new Date(r.createdAt).toLocaleString()}</p>
                <p>{r.branch.name}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs uppercase text-gray-500">Supplier</p>
                <p className="font-semibold">{r.supplier?.name ?? "—"}</p>
                {r.deliveryNote && <p>Delivery note / invoice: {r.deliveryNote}</p>}
              </div>
              <div>
                {r.purchaseOrder && <p>Against order {r.purchaseOrder.reference ?? r.purchaseOrder.id.slice(0, 8)}</p>}
                {r.bills[0] && <p>Bill {r.bills[0].billNumber}: {kes(r.bills[0].total)}</p>}
              </div>
            </div>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Received</th>
                  <th className="py-1 text-right">Damaged</th>
                  <th className="py-1 text-right">Price</th>
                  <th className="py-1 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id} className="border-b border-gray-200">
                    <td className="py-1">
                      {l.name} <span className="text-gray-500">({l.sku})</span>
                      {l.damagedNote && <span className="block text-xs text-gray-600">Damaged: {l.damagedNote}</span>}
                    </td>
                    <td className="py-1 text-right">{l.quantityAccepted}</td>
                    <td className="py-1 text-right">{l.quantityDamaged || ""}</td>
                    <td className="py-1 text-right">{l.unitCost === null ? "—" : l.unitCost.toLocaleString("en-KE", { minimumFractionDigits: 2 })}</td>
                    <td className="py-1 text-right">{l.value === null ? "—" : l.value.toLocaleString("en-KE", { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total !== null && <p className="mt-3 text-right text-base font-bold">Total accepted: {kes(total)}</p>}
            {r.notes && <p className="mt-3 text-sm text-gray-700">{r.notes}</p>}
            <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
              <div className="border-t border-gray-500 pt-1">Received by</div>
              <div className="border-t border-gray-500 pt-1">Supplier&apos;s representative</div>
            </div>
            <div className="mt-8 border-t border-gray-300 pt-3 text-center text-[10px] italic text-gray-500">
              <p>Powered by ZARODA SOLUTIONS</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
