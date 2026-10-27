"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface KraReceiptData {
  title: string;
  kind: "SALE" | "CREDIT";
  copy: boolean;
  copyNotice: { label: string; note: string } | null;
  business: { name: string; address: string | null; pin: string | null };
  buyerPin: string | null;
  originalCuInvoiceNo: string | null;
  creditNote: string | null;
  lines: { name: string; unitPrice: number; quantity: number; amount: number; taxLetter: string; discount: { rate: number; amount: number } | null; total: number }[];
  itemsNumber: number;
  totals: { beforeDiscount: number; discount: number; subTotal: number; vat: number; total: number };
  payment: { label: string; amount: number };
  taxTable: { letter: string; label: string; rate: number; taxable: number; tax: number }[];
  scu: { date: string | null; time: string | null; scuId: string; cuInvoiceNo: string; receiptCounter: string | null; internalData: string; signature: string; qr: string | null };
  tis: { receiptNumber: string; date: string; time: string };
}

const m = (n: number) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rule = <hr className="my-1.5 border-0 border-t border-dashed border-black" />;

/**
 * A receipt in the layout of KRA's trader-system specification: the business and its PIN, the items with their tax letters, the
 * totals and the tax table, then the SCU information KRA returned (date, CU number, internal data, signature, QR code) and the
 * till's own receipt number. A reprint carries a large COPY mark and "THIS IS NOT AN OFFICIAL RECEIPT". Sized for an 80 mm roll.
 */
export function KraReceipt({ r }: { r: KraReceiptData }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (r.scu.qr) void QRCode.toDataURL(r.scu.qr, { margin: 1, width: 220 }).then(setQr);
  }, [r.scu.qr]);
  return (
    <div className="relative mx-auto w-[302px] bg-white p-3 font-mono text-[12px] leading-snug text-black print:w-[302px]">
      {r.copy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-30 select-none text-6xl font-black tracking-widest text-black/10">COPY</span>
        </div>
      )}
      <div className="text-center">
        <p className="text-sm font-bold">{r.business.name}</p>
        {r.business.address && <p>{r.business.address}</p>}
        {r.business.pin && <p>PIN: {r.business.pin}</p>}
        <p className="mt-1 text-sm font-bold">{r.title}</p>
        {r.originalCuInvoiceNo && <p>ORIGINAL CU INVOICE NO.#: {r.originalCuInvoiceNo}</p>}
        {r.copyNotice && <p className="text-2xl font-black">{r.copyNotice.label}</p>}
      </div>
      {rule}
      {r.creditNote && <p className="text-center">{r.creditNote}</p>}
      {r.buyerPin && <p className="text-center">Buyer PIN: {r.buyerPin}</p>}
      {(r.creditNote || r.buyerPin) && rule}
      {r.lines.map((l, i) => (
        <div key={i} className="mb-1">
          <p>{l.name}</p>
          <p className="flex justify-between">
            <span>
              {m(l.unitPrice)}x {l.quantity}
            </span>
            <span>
              {m(l.amount)}
              {l.taxLetter}
            </span>
          </p>
          {l.discount && (
            <p className="flex justify-between">
              <span>Discount {l.discount.rate}%</span>
              <span>({m(Math.abs(l.discount.amount))})</span>
            </p>
          )}
        </div>
      ))}
      {rule}
      {r.totals.discount !== 0 && (
        <>
          <p className="flex justify-between"><span>TOTAL BEFORE DISCOUNT</span><span>{m(r.totals.beforeDiscount)}</span></p>
          <p className="flex justify-between"><span>TOTAL DISCOUNT AWARDED</span><span>({m(Math.abs(r.totals.discount))})</span></p>
        </>
      )}
      <p className="flex justify-between"><span>SUB TOTAL</span><span>{m(r.totals.subTotal)}</span></p>
      <p className="flex justify-between"><span>VAT</span><span>{m(r.totals.vat)}</span></p>
      <p className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{m(r.totals.total)}</span></p>
      {r.copyNotice && <p className="mt-1 text-center text-base font-black">{r.copyNotice.note}</p>}
      {rule}
      <p className="flex justify-between"><span>{r.payment.label}</span><span>{m(r.payment.amount)}</span></p>
      <p className="flex justify-between"><span>ITEMS NUMBER</span><span>{r.itemsNumber}</span></p>
      {rule}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left"><th>Rate</th><th className="text-right">Taxable</th><th className="text-right">VAT</th></tr>
        </thead>
        <tbody>
          {r.taxTable.map((t) => (
            <tr key={t.letter}>
              <td>{t.label}</td>
              <td className="text-right">{m(t.taxable)}</td>
              <td className="text-right">{m(t.tax)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rule}
      <div className="text-center">
        <p className="font-bold">SCU INFORMATION</p>
        <p className="flex justify-between"><span>Date: {r.scu.date ?? "-"}</span><span>Time: {r.scu.time ?? "-"}</span></p>
        <p className="text-left">SCU ID: {r.scu.scuId}</p>
        <p className="text-left">CU INVOICE NO.: {r.scu.cuInvoiceNo}</p>
        {r.scu.receiptCounter && <p className="text-left">Receipt counter: {r.scu.receiptCounter}</p>}
        <p className="mt-1">Internal Data:</p>
        <p className="break-all">{r.scu.internalData}</p>
        <p className="mt-1">Receipt Signature:</p>
        <p className="break-all">{r.scu.signature}</p>
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Receipt QR code" className="mx-auto mt-2 h-28 w-28" />
        )}
      </div>
      {rule}
      <div className="text-center">
        <p className="font-bold">TIS INFORMATION</p>
        <p className="flex justify-between"><span>RECEIPT NUMBER:</span><span>{r.tis.receiptNumber}</span></p>
        <p className="flex justify-between"><span>DATE: {r.tis.date}</span><span>TIME: {r.tis.time}</span></p>
        {rule}
        <p>THANK YOU</p>
      </div>
    </div>
  );
}
