"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../../lib/api";

interface PlatformInvoice {
  id: string;
  invoiceNumber: string;
  kind: "SUBSCRIPTION" | "COLLECTION_FEE";
  invoiceMonth: string;
  plan: string;
  occupiedUnits: number;
  matchedRentTotal: number | null;
  amountDue: number;
  status: "ISSUED" | "PAID" | "WAIVED";
  dueDate: string;
  paidAt: string | null;
}

interface Subscription {
  readOnly: boolean;
  enforced: boolean;
  invoices: PlatformInvoice[];
}

const money = (n: number) => n.toLocaleString("en-KE");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const monthName = (m: string) => {
  const [year, month] = m.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** What ZARODA has billed this landlord for the rental plan, and a warning when one is overdue. */
export function InvoicesPanel() {
  const [data, setData] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Subscription>("/rental/subscription")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your invoices."));
  }, []);

  if (error) return <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>;
  if (!data) return null;
  const unpaid = data.invoices.filter((i) => i.status === "ISSUED");

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Your Zaroda invoices</p>
      {data.readOnly && (
        <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">
          {data.enforced
            ? "An invoice is overdue, so your account is read-only: you can see everything but cannot change anything until it is paid. Nothing has been deleted."
            : "An invoice is overdue. Please pay it soon to keep your account fully open."}
        </p>
      )}
      {!data.readOnly && unpaid.length > 0 && (
        <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">
          You have {unpaid.length} unpaid {unpaid.length === 1 ? "invoice" : "invoices"}. Invoices are due on the 15th; after that the account becomes read-only until they are paid.
        </p>
      )}
      {data.invoices.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm text-secondary-500">No invoices yet. Invoices are issued on the 1st of the month for paid plans.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-secondary-500">
              <tr>
                <th className="p-2">Invoice</th>
                <th className="p-2">For</th>
                <th className="p-2">Units</th>
                <th className="p-2">Amount (KES)</th>
                <th className="p-2">Due</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="p-2 font-medium">{i.invoiceNumber}</td>
                  <td className="p-2">
                    {i.kind === "COLLECTION_FEE" ? "1% of rent collected" : "Plan fee"}
                    <span className="block text-xs text-secondary-500">{monthName(i.invoiceMonth)}{i.matchedRentTotal !== null ? ` - KES ${money(i.matchedRentTotal)} collected` : ""}</span>
                  </td>
                  <td className="p-2">{i.occupiedUnits}</td>
                  <td className="p-2">{money(i.amountDue)}</td>
                  <td className="p-2">{day(i.dueDate)}</td>
                  <td className={`p-2 ${i.status === "PAID" ? "text-green-400" : i.status === "ISSUED" ? "text-amber-400" : "text-secondary-500"}`}>
                    {i.status === "PAID" ? `Paid${i.paidAt ? ` ${day(i.paidAt)}` : ""}` : i.status === "WAIVED" ? "Waived" : "Unpaid"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unpaid.length > 0 && <p className="text-xs text-secondary-500">To pay an invoice, contact Zaroda support with the invoice number. Paying online from this screen is coming soon.</p>}
    </div>
  );
}
