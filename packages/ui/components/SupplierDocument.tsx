"use client";

import type { ReactNode } from "react";
import { amountInWords } from "../lib/amount-in-words";

// The printed paperwork of selling to schools on credit: invoice, delivery note, receipt and statement. One component for
// both the supplier's back office and the school's own portal, so both sides print exactly the same document.

export interface DocBusiness {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  invoiceFooter: string | null;
}
export interface DocSchool {
  name: string;
  contactName?: string | null;
  phone?: string;
  address?: string | null;
}
export interface DocInvoice {
  invoiceNumber: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  school: DocSchool;
  order: { orderNumber: string; lpoNumber: string | null; deliveryNoteNumber: string | null } | null;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  /** What credit notes have taken off, and which. */
  creditAmount?: number;
  creditNotes?: { creditNumber: string; total: number; issueDate: string }[];
  balance: number;
  voidReason: string | null;
  lines: { id: string; description: string; quantity: number; unitPrice: number; taxRate: number; lineTotal: number; taxAmount: number }[];
  payments: { receiptNumber: string; receivedOn: string | null; method: string; amount: number }[];
  business: DocBusiness;
}
/** One delivery's note: this drop, and how the order stands (ordered, delivered before, delivered now, still to come). */
export interface DocDelivery {
  deliveryNoteNumber: string;
  sequence: number;
  deliveredAt: string;
  receivedByName: string;
  notes: string | null;
  schoolConfirmedAt: string | null;
  schoolConfirmedBy: string | null;
  orderNumber: string;
  lpoNumber: string | null;
  deliveryAddress: string | null;
  school: DocSchool;
  lines: { id: string; title: string; sku: string; ordered: number; before: number; now: number; balance: number }[];
  invoice: { invoiceNumber: string } | null;
  business: DocBusiness;
}

/** A credit to a school against one of its invoices. */
export interface DocCreditNote {
  creditNumber: string;
  issueDate: string;
  reasonText: string;
  note: string | null;
  school: DocSchool;
  invoice: { invoiceNumber: string };
  subtotal: number;
  taxAmount: number;
  total: number;
  restocked: boolean;
  lines: { id: string; description: string; quantity: number; unitPrice: number; taxRate: number; lineTotal: number; taxAmount: number }[];
  business: DocBusiness;
}

/** A quotation to a school. */
export interface DocQuote {
  quoteNumber: string | null;
  status: string;
  school: DocSchool;
  issueDate: string | null;
  validUntil: string | null;
  terms: string | null;
  lines: { id: string; description: string; quantity: number; unitPrice: number; taxRate: number; lineTotal: number; taxAmount: number }[];
  subtotal: number;
  taxAmount: number;
  total: number;
  business: DocBusiness;
}

export interface DocReceipt {
  receiptNumber: string;
  status: string;
  school: DocSchool;
  amount: number;
  method: string;
  reference: string | null;
  bankName: string | null;
  chequeDate: string | null;
  receivedOn: string | null;
  bounceReason: string | null;
  onAccount: number;
  allocations: { invoiceId: string; invoiceNumber: string; invoiceTotal: number; amount: number }[];
  business: DocBusiness;
}
export interface DocStatement {
  school: DocSchool;
  openingBalance: number;
  closingBalance: number;
  from: string | null;
  to: string | null;
  entries: { date: string; kind: string; reference: string; description: string; debit: number; credit: number; balance: number }[];
  owed: number;
  overdue: number;
  credit: number;
  ageing: { CURRENT: number; DAYS_1_30: number; DAYS_31_60: number; DAYS_61_90: number; OVER_90: number } | null;
  business: DocBusiness;
}

const money = (v: number) => v.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: number) => v.toLocaleString("en-KE", { maximumFractionDigits: 3 });
const METHOD: Record<string, string> = { CHEQUE: "Cheque", BANK_TRANSFER: "Bank transfer", MPESA: "M-Pesa", CASH: "Cash" };

function Letterhead({ business, title, number }: { business: DocBusiness; title: string; number?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-400 pb-3">
      <div>
        <h1 className="text-xl font-bold">{business.name}</h1>
        {business.address && <p className="text-sm text-gray-700">{business.address}</p>}
        <p className="text-sm text-gray-700">{[business.phone, business.email].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="text-right">
        <p className="text-lg font-bold uppercase tracking-wide">{title}</p>
        {number && <p className="font-mono text-sm">{number}</p>}
      </div>
    </div>
  );
}

function Footer({ note, children }: { note?: string | null; children?: ReactNode }) {
  return (
    <div className="mt-8 border-t border-gray-300 pt-3 text-center text-[10px] italic text-gray-500">
      {children}
      {note && <p className="not-italic text-xs text-gray-700">{note}</p>}
      <p>This is a computer-generated document.</p>
      <p>Powered by ZARODA SOLUTIONS</p>
    </div>
  );
}

function Parties({ school, rows }: { school: DocSchool; rows: [string, string | null | undefined][] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
      <div>
        <p className="text-xs uppercase text-gray-500">To</p>
        <p className="font-semibold">{school.name}</p>
        {school.contactName && <p>Attn: {school.contactName}</p>}
        {school.address && <p>{school.address}</p>}
        {school.phone && <p>{school.phone}</p>}
      </div>
      <table className="text-sm">
        <tbody>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <tr key={k}>
                <td className="pr-3 text-gray-600">{k}</td>
                <td className="font-medium">{v}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function InvoiceDocument({ invoice }: { invoice: DocInvoice }) {
  return (
    <div className="rounded border border-gray-400 p-6">
      <Letterhead business={invoice.business} title="Invoice" number={invoice.invoiceNumber} />
      {invoice.status === "VOID" && <p className="my-2 rounded bg-red-100 p-2 text-sm font-bold text-red-800">VOID{invoice.voidReason ? ` - ${invoice.voidReason}` : ""}</p>}
      <Parties
        school={invoice.school}
        rows={[
          ["Invoice date", invoice.issueDate],
          ["Due date", invoice.dueDate],
          ["Order no.", invoice.order?.orderNumber],
          ["LPO no.", invoice.order?.lpoNumber],
          ["Delivery note", invoice.order?.deliveryNoteNumber],
        ]}
      />
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600">
            <th className="py-1">Item</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Price</th>
            <th className="py-1 text-right">VAT</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-200">
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right">{qty(l.quantity)}</td>
              <td className="py-1 text-right">{money(l.unitPrice)}</td>
              <td className="py-1 text-right">{l.taxAmount ? money(l.taxAmount) : "-"}</td>
              <td className="py-1 text-right">{money(l.lineTotal + l.taxAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="ml-auto mt-3 text-sm">
        <tbody>
          <tr><td className="pr-6 text-gray-600">Subtotal</td><td className="text-right">KES {money(invoice.subtotal)}</td></tr>
          <tr><td className="pr-6 text-gray-600">VAT</td><td className="text-right">KES {money(invoice.taxAmount)}</td></tr>
          <tr className="font-bold"><td className="pr-6">Total</td><td className="text-right">KES {money(invoice.total)}</td></tr>
          {(invoice.creditAmount ?? 0) > 0 && <tr><td className="pr-6 text-gray-600">Credit notes</td><td className="text-right">- KES {money(invoice.creditAmount ?? 0)}</td></tr>}
          {invoice.amountPaid > 0 && <tr><td className="pr-6 text-gray-600">Paid so far</td><td className="text-right">KES {money(invoice.amountPaid)}</td></tr>}
          <tr className="text-base font-bold"><td className="pr-6">Balance due</td><td className="text-right">KES {money(invoice.balance)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-right text-xs italic text-gray-600">Invoice total in words: {amountInWords(invoice.total)}</p>
      {(invoice.creditNotes ?? []).length > 0 && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">Credit notes</p>
          {(invoice.creditNotes ?? []).map((c) => (
            <p key={c.creditNumber} className="flex justify-between border-b border-gray-200 py-1">
              <span>{c.issueDate} · {c.creditNumber}</span>
              <span>KES {money(c.total)}</span>
            </p>
          ))}
        </div>
      )}
      {invoice.payments.length > 0 && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">Payments received</p>
          {invoice.payments.map((p) => (
            <p key={p.receiptNumber} className="flex justify-between border-b border-gray-200 py-1">
              <span>{p.receivedOn} · {p.receiptNumber} · {METHOD[p.method] ?? p.method}</span>
              <span>KES {money(p.amount)}</span>
            </p>
          ))}
        </div>
      )}
      <Footer note={invoice.business.invoiceFooter} />
    </div>
  );
}

export function DeliveryNoteDocument({ delivery }: { delivery: DocDelivery }) {
  const anyBalance = delivery.lines.some((l) => l.balance > 0);
  return (
    <div className="rounded border border-gray-400 p-6">
      <Letterhead business={delivery.business} title="Delivery note" number={delivery.deliveryNoteNumber} />
      <Parties
        school={delivery.school}
        rows={[
          ["Delivered on", delivery.deliveredAt.slice(0, 10)],
          ["Delivery", `No. ${delivery.sequence} for this order`],
          ["Order no.", delivery.orderNumber],
          ["LPO no.", delivery.lpoNumber],
          ["Deliver to", delivery.deliveryAddress],
          ["Invoice", delivery.invoice?.invoiceNumber],
        ]}
      />
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600">
            <th className="py-1">Item</th>
            <th className="py-1 text-right">Ordered</th>
            <th className="py-1 text-right">Delivered before</th>
            <th className="py-1 text-right">Delivered now</th>
            <th className="py-1 text-right">Still to come</th>
          </tr>
        </thead>
        <tbody>
          {delivery.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-200">
              <td className="py-1">{l.title}</td>
              <td className="py-1 text-right">{qty(l.ordered)}</td>
              <td className="py-1 text-right">{qty(l.before)}</td>
              <td className="py-1 text-right font-semibold">{qty(l.now)}</td>
              <td className="py-1 text-right">{l.balance > 0 ? qty(l.balance) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {anyBalance ? (
        <p className="mt-3 text-sm text-gray-700">Part delivery: the items marked &quot;still to come&quot; will follow on a later delivery note.</p>
      ) : (
        <p className="mt-3 text-sm text-gray-700">With this delivery the order is complete.</p>
      )}
      {delivery.notes && <p className="mt-2 text-sm text-gray-700">Note: {delivery.notes}</p>}
      <p className="mt-6 text-sm">Goods received in good order by: <strong>{delivery.receivedByName || "____________________"}</strong></p>
      {delivery.schoolConfirmedAt && (
        <p className="mt-1 text-sm text-gray-700">
          Receipt confirmed by the school online: {delivery.schoolConfirmedBy ?? ""} on {delivery.schoolConfirmedAt.slice(0, 10)}.
        </p>
      )}
      <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
        <p className="border-t border-gray-500 pt-1">Received by (name, signature, date) - school stamp</p>
        <p className="border-t border-gray-500 pt-1">Delivered by (name, signature)</p>
      </div>
      <Footer />
    </div>
  );
}

export function CreditNoteDocument({ creditNote }: { creditNote: DocCreditNote }) {
  return (
    <div className="rounded border border-gray-400 p-6">
      <Letterhead business={creditNote.business} title="Credit note" number={creditNote.creditNumber} />
      <Parties
        school={creditNote.school}
        rows={[
          ["Date", creditNote.issueDate],
          ["Against invoice", creditNote.invoice.invoiceNumber],
          ["Reason", creditNote.reasonText],
        ]}
      />
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600">
            <th className="py-1">Item</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Price</th>
            <th className="py-1 text-right">VAT</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {creditNote.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-200">
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right">{qty(l.quantity)}</td>
              <td className="py-1 text-right">{money(l.unitPrice)}</td>
              <td className="py-1 text-right">{l.taxAmount ? money(l.taxAmount) : "-"}</td>
              <td className="py-1 text-right">{money(l.lineTotal + l.taxAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="ml-auto mt-3 text-sm">
        <tbody>
          <tr><td className="pr-6 text-gray-600">Subtotal</td><td className="text-right">KES {money(creditNote.subtotal)}</td></tr>
          <tr><td className="pr-6 text-gray-600">VAT</td><td className="text-right">KES {money(creditNote.taxAmount)}</td></tr>
          <tr className="text-base font-bold"><td className="pr-6">Total credited</td><td className="text-right">KES {money(creditNote.total)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-right text-xs italic text-gray-600">{amountInWords(creditNote.total)}</p>
      {creditNote.note && <p className="mt-3 text-sm text-gray-700">Note: {creditNote.note}</p>}
      <p className="mt-3 text-sm text-gray-700">This amount has been taken off what you owe on invoice {creditNote.invoice.invoiceNumber}.{creditNote.restocked ? " The goods returned have been received back." : ""}</p>
      <Footer note={creditNote.business.invoiceFooter} />
    </div>
  );
}

export function QuoteDocument({ quote }: { quote: DocQuote }) {
  return (
    <div className="rounded border border-gray-400 p-6">
      <Letterhead business={quote.business} title="Quotation" number={quote.quoteNumber ?? undefined} />
      {!quote.quoteNumber && <p className="my-2 rounded bg-amber-100 p-2 text-sm font-bold text-amber-800">DRAFT - not yet issued</p>}
      {quote.status === "EXPIRED" && <p className="my-2 rounded bg-red-100 p-2 text-sm font-bold text-red-800">EXPIRED</p>}
      {quote.status === "SUPERSEDED" && <p className="my-2 rounded bg-red-100 p-2 text-sm font-bold text-red-800">REPLACED BY A NEWER QUOTATION</p>}
      <Parties
        school={quote.school}
        rows={[
          ["Date", quote.issueDate],
          ["Valid until", quote.validUntil],
        ]}
      />
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600">
            <th className="py-1">Item</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Price</th>
            <th className="py-1 text-right">VAT</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-200">
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right">{qty(l.quantity)}</td>
              <td className="py-1 text-right">{money(l.unitPrice)}</td>
              <td className="py-1 text-right">{l.taxAmount ? money(l.taxAmount) : "-"}</td>
              <td className="py-1 text-right">{money(l.lineTotal + l.taxAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="ml-auto mt-3 text-sm">
        <tbody>
          <tr><td className="pr-6 text-gray-600">Subtotal</td><td className="text-right">KES {money(quote.subtotal)}</td></tr>
          <tr><td className="pr-6 text-gray-600">VAT</td><td className="text-right">KES {money(quote.taxAmount)}</td></tr>
          <tr className="text-base font-bold"><td className="pr-6">Total</td><td className="text-right">KES {money(quote.total)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-right text-xs italic text-gray-600">{amountInWords(quote.total)}</p>
      {quote.terms && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">Terms</p>
          <p className="whitespace-pre-line text-gray-700">{quote.terms}</p>
        </div>
      )}
      <p className="mt-4 text-sm text-gray-700">To accept this quotation, accept it in your ordering portal or send us your LPO quoting the quotation number.</p>
      <Footer note={quote.business.invoiceFooter} />
    </div>
  );
}

export function ReceiptDocument({ receipt }: { receipt: DocReceipt }) {
  return (
    <div className="rounded border border-gray-400 p-6">
      <Letterhead business={receipt.business} title="Payment receipt" number={receipt.receiptNumber} />
      {receipt.status === "BOUNCED" && <p className="my-2 rounded bg-red-100 p-2 text-sm font-bold text-red-800">NOT CLEARED{receipt.bounceReason ? ` - ${receipt.bounceReason}` : ""}</p>}
      <table className="mt-4 w-full text-sm">
        <tbody>
          <tr><td className="py-1 text-gray-600">Date received</td><td className="py-1">{receipt.receivedOn}</td></tr>
          <tr><td className="py-1 text-gray-600">Received from</td><td className="py-1">{receipt.school.name}</td></tr>
          <tr>
            <td className="py-1 text-gray-600">Paid by</td>
            <td className="py-1">
              {METHOD[receipt.method] ?? receipt.method}
              {receipt.reference ? ` no. ${receipt.reference}` : ""}
              {receipt.bankName ? `, ${receipt.bankName}` : ""}
              {receipt.chequeDate ? `, dated ${receipt.chequeDate}` : ""}
            </td>
          </tr>
          <tr><td className="py-1 text-gray-600">Amount</td><td className="py-1 text-lg font-bold">KES {money(receipt.amount)}</td></tr>
          <tr><td className="py-1 text-gray-600">In words</td><td className="py-1 italic">{amountInWords(receipt.amount)}</td></tr>
        </tbody>
      </table>
      {receipt.allocations.length > 0 && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">Paid towards</p>
          {receipt.allocations.map((a) => (
            <p key={a.invoiceId} className="flex justify-between border-b border-gray-200 py-1">
              <span>Invoice {a.invoiceNumber} (total KES {money(a.invoiceTotal)})</span>
              <span>KES {money(a.amount)}</span>
            </p>
          ))}
        </div>
      )}
      {receipt.onAccount > 0 && <p className="mt-2 text-sm">Kept as credit on your account: KES {money(receipt.onAccount)}</p>}
      <p className="mt-6 text-xs text-gray-500">Thank you. A cheque is received subject to it being cleared by the bank.</p>
      <Footer />
    </div>
  );
}

export function StatementDocument({ statement }: { statement: DocStatement }) {
  const ageing = statement.ageing;
  return (
    <div className="rounded border border-gray-400 p-6">
      <Letterhead business={statement.business} title="Statement of account" />
      <Parties school={statement.school} rows={[["Period", `${statement.from ?? "start"} to ${statement.to ?? "today"}`]]} />
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600">
            <th className="py-1">Date</th>
            <th className="py-1">Details</th>
            <th className="py-1 text-right">Invoiced</th>
            <th className="py-1 text-right">Paid / credited</th>
            <th className="py-1 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {statement.from && (
            <tr className="border-b border-gray-200 italic text-gray-600">
              <td className="py-1" colSpan={4}>Balance brought forward</td>
              <td className="py-1 text-right">{money(statement.openingBalance)}</td>
            </tr>
          )}
          {statement.entries.map((e, i) => (
            <tr key={i} className="border-b border-gray-200">
              <td className="py-1">{e.date}</td>
              <td className="py-1">{e.reference} - {e.description}</td>
              <td className="py-1 text-right">{e.debit ? money(e.debit) : ""}</td>
              <td className="py-1 text-right">{e.credit ? money(e.credit) : ""}</td>
              <td className="py-1 text-right">{money(e.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-right text-base font-bold">
        {statement.closingBalance > 0 ? `Balance owing: KES ${money(statement.closingBalance)}` : statement.closingBalance < 0 ? `In credit: KES ${money(-statement.closingBalance)}` : "Fully paid up"}
      </p>
      {ageing && statement.owed > 0 && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">How late the unpaid invoices are</p>
          <table className="mt-1 w-full text-center">
            <thead>
              <tr className="text-xs uppercase text-gray-600">
                <th>Not yet due</th><th>1-30 days</th><th>31-60 days</th><th>61-90 days</th><th>Over 90</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{money(ageing.CURRENT)}</td><td>{money(ageing.DAYS_1_30)}</td><td>{money(ageing.DAYS_31_60)}</td><td>{money(ageing.DAYS_61_90)}</td><td>{money(ageing.OVER_90)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <Footer note={statement.business.invoiceFooter} />
    </div>
  );
}
