"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, ApiError } from "../../../../../lib/api";
import { getSession } from "../../../../../lib/auth";

interface Party {
  name: string;
  phone: string | null;
}
interface Property {
  name: string;
  address: string | null;
}
interface Receipt {
  receiptNumber: string;
  business: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  note: string | null;
  voided: boolean;
  voidReason: string | null;
  tenant: Party;
  property: Property;
  unit: string;
  appliedTo: { description: string; amount: number }[];
  keptAsCredit: number;
  balanceAfter: number;
}
interface Statement {
  business: string;
  tenant: Party;
  property: Property;
  unit: string;
  startDate: string;
  monthlyRent: number;
  lines: { date: string; description: string; reference: string | null; charge: number; paid: number; balance: number }[];
  balance: number;
  printedOn: string;
}

const money = (v: number) => v.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);
const METHOD_LABEL: Record<string, string> = { CASH: "Cash", BANK: "Bank", MPESA: "M-Pesa", TUMA: "M-Pesa", DARAJA: "M-Pesa", OTHER: "Other" };

/** A plain white page meant for the printer (or "save as PDF"): one rent receipt or one tenant statement. */
export default function PrintPage() {
  const router = useRouter();
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/login");
      return;
    }
    const load = kind === "statement" ? apiGet<Statement>(`/rental/leases/${id}/statement`).then(setStatement) : apiGet<Receipt>(`/rental/payments/${id}`).then(setReceipt);
    load.catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this page."));
  }, [kind, id, router]);

  return (
    <div className="min-h-screen bg-white p-6 text-black print:p-0">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <button onClick={() => window.print()} className="rounded-md bg-blue-700 px-3 py-2 text-sm text-white">Print / save as PDF</button>
        </div>
        {error && <p className="text-red-700">{error}</p>}

        {receipt && (
          <div className="rounded border border-gray-400 p-6">
            <h1 className="text-xl font-bold">{receipt.business}</h1>
            <p className="text-sm text-gray-600">Rent receipt</p>
            {receipt.voided && <p className="my-2 rounded bg-red-100 p-2 text-sm font-bold text-red-800">VOID{receipt.voidReason ? ` - ${receipt.voidReason}` : ""}</p>}
            <table className="mt-4 w-full text-sm">
              <tbody>
                <tr><td className="py-1 text-gray-600">Receipt no.</td><td className="py-1 font-semibold">{receipt.receiptNumber}</td></tr>
                <tr><td className="py-1 text-gray-600">Date</td><td className="py-1">{day(receipt.paidAt)}</td></tr>
                <tr><td className="py-1 text-gray-600">Received from</td><td className="py-1">{receipt.tenant.name}</td></tr>
                <tr><td className="py-1 text-gray-600">Property</td><td className="py-1">{receipt.property.name} - {receipt.unit}{receipt.property.address ? `, ${receipt.property.address}` : ""}</td></tr>
                <tr><td className="py-1 text-gray-600">Paid by</td><td className="py-1">{METHOD_LABEL[receipt.method] ?? receipt.method}{receipt.reference ? ` (${receipt.reference})` : ""}</td></tr>
                <tr><td className="py-1 text-gray-600">Amount</td><td className="py-1 text-lg font-bold">KES {money(receipt.amount)}</td></tr>
              </tbody>
            </table>
            {receipt.appliedTo.length > 0 && (
              <div className="mt-4 text-sm">
                <p className="font-semibold">Paid towards</p>
                {receipt.appliedTo.map((a, i) => (
                  <p key={i} className="flex justify-between border-b border-gray-200 py-1"><span>{a.description}</span><span>KES {money(a.amount)}</span></p>
                ))}
              </div>
            )}
            {receipt.keptAsCredit > 0 && <p className="mt-2 text-sm">Kept as credit for future rent: KES {money(receipt.keptAsCredit)}</p>}
            {receipt.note && <p className="mt-2 text-sm text-gray-600">Note: {receipt.note}</p>}
            <p className="mt-4 text-sm">Balance still owing after this payment: <strong>KES {money(receipt.balanceAfter)}</strong></p>
            <p className="mt-8 text-xs text-gray-500">Thank you.</p>
          </div>
        )}

        {statement && (
          <div className="rounded border border-gray-400 p-6">
            <h1 className="text-xl font-bold">{statement.business}</h1>
            <p className="text-sm text-gray-600">Tenant statement as at {day(statement.printedOn)}</p>
            <p className="mt-3 text-sm">
              <strong>{statement.tenant.name}</strong> - {statement.property.name}, {statement.unit}
              <br />
              Rent KES {money(statement.monthlyRent)} per month, since {day(statement.startDate)}
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600">
                  <th className="py-1">Date</th>
                  <th className="py-1">Details</th>
                  <th className="py-1 text-right">Charged</th>
                  <th className="py-1 text-right">Paid</th>
                  <th className="py-1 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-200">
                    <td className="py-1">{day(l.date)}</td>
                    <td className="py-1">{l.description}{l.reference ? ` (${l.reference})` : ""}</td>
                    <td className="py-1 text-right">{l.charge ? money(l.charge) : ""}</td>
                    <td className="py-1 text-right">{l.paid ? money(l.paid) : ""}</td>
                    <td className="py-1 text-right">{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-right text-base font-bold">
              {statement.balance > 0 ? `Balance owing: KES ${money(statement.balance)}` : statement.balance < 0 ? `In credit: KES ${money(-statement.balance)}` : "Fully paid up"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
