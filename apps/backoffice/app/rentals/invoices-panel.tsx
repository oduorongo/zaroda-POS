"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../../lib/api";

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
  paymentMethod: string | null;
  paymentPending: boolean;
  payPhone: string | null;
  lastPaymentError: string | null;
}

interface Subscription {
  readOnly: boolean;
  enforced: boolean;
  canPayOnline: boolean;
  invoices: PlatformInvoice[];
}

const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const smallButton = "rounded border border-border px-2 py-1 text-xs hover:bg-background disabled:opacity-50";
const input = "rounded-md border border-border bg-surface p-2 text-sm";

const money = (n: number) => n.toLocaleString("en-KE");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const monthName = (m: string) => {
  const [year, month] = m.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** What ZARODA has billed this landlord for the rental plan, a warning when one is overdue, and paying by M-Pesa. */
export function InvoicesPanel() {
  const [data, setData] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<PlatformInvoice | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiGet<Subscription>("/rental/subscription")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your invoices."));

  useEffect(() => {
    void load();
  }, []);

  // While the PIN is being entered, keep the list fresh with free reads so the invoice flips to Paid by itself.
  const waiting = data?.invoices.some((i) => i.paymentPending) ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function startPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paying) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiPost<PlatformInvoice>(`/rental/subscription/invoices/${paying.id}/pay`, { phone: phone.trim() });
      if (result.lastPaymentError) {
        setError(result.lastPaymentError);
      } else {
        setNotice("Check your phone and enter your M-Pesa PIN. This page updates by itself once the payment goes through.");
        setPaying(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the payment.");
    } finally {
      setBusy(false);
    }
  }

  async function checkNow(invoice: PlatformInvoice) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiPost<{ checkResult: "paid" | "not-paid-yet" | "unavailable" | "not-needed" }>(`/rental/subscription/invoices/${invoice.id}/check`, {});
      if (result.checkResult === "paid") setNotice("Payment received. Thank you!");
      else if (result.checkResult === "not-paid-yet") setNotice("Not paid yet. If you have entered your PIN, give it a minute.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p> : null;
  const unpaid = data.invoices.filter((i) => i.status === "ISSUED");

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Your Zaroda invoices</p>
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
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

      {paying && (
        <form onSubmit={startPayment} className="grid gap-2 rounded-lg border-2 border-green-600 bg-surface p-3 sm:grid-cols-4">
          <p className="text-sm font-semibold sm:col-span-4">
            Pay KES {money(paying.amountDue)} for {paying.invoiceNumber} by M-Pesa
          </p>
          <input className={`${input} sm:col-span-2`} inputMode="tel" placeholder="M-Pesa phone, e.g. 0712 345 678" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className={button} disabled={busy || !phone.trim()}>Send M-Pesa prompt</button>
          <button type="button" className={smallButton} onClick={() => setPaying(null)}>Cancel</button>
        </form>
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
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="p-2 font-medium">{i.invoiceNumber}</td>
                  <td className="p-2">
                    {i.kind === "COLLECTION_FEE" ? "1% of rent collected" : "Plan fee"}
                    <span className="block text-xs text-secondary-500">
                      {monthName(i.invoiceMonth)}
                      {i.matchedRentTotal !== null ? ` - KES ${money(i.matchedRentTotal)} collected` : ""}
                    </span>
                  </td>
                  <td className="p-2">{i.occupiedUnits}</td>
                  <td className="p-2">{money(i.amountDue)}</td>
                  <td className="p-2">{day(i.dueDate)}</td>
                  <td className={`p-2 ${i.status === "PAID" ? "text-green-400" : i.status === "ISSUED" ? "text-amber-400" : "text-secondary-500"}`}>
                    {i.status === "PAID" ? `Paid${i.paidAt ? ` ${day(i.paidAt)}` : ""}` : i.status === "WAIVED" ? "Waived" : i.paymentPending ? "Waiting for your PIN..." : "Unpaid"}
                    {i.status === "ISSUED" && i.lastPaymentError && <span className="block text-xs text-red-400">{i.lastPaymentError}</span>}
                  </td>
                  <td className="space-x-1 p-2 text-right whitespace-nowrap">
                    {i.status === "ISSUED" && data.canPayOnline && (
                      <button
                        className={smallButton}
                        disabled={busy || i.paymentPending}
                        onClick={() => {
                          setPaying(i);
                          setPhone(i.payPhone ?? "");
                          setNotice(null);
                          setError(null);
                        }}
                      >
                        Pay with M-Pesa
                      </button>
                    )}
                    {i.status === "ISSUED" && i.paymentPending && (
                      <button className={smallButton} disabled={busy} onClick={() => void checkNow(i)}>Check now</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unpaid.length > 0 && !data.canPayOnline && <p className="text-xs text-secondary-500">Online payment is not available just now. Contact Zaroda support with the invoice number to pay.</p>}
    </div>
  );
}
