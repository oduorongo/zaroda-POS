import { BRAND, brandButton, brandedEmail } from '../common/email/brand-layout';
import { PlatformInvoiceKind, PlatformReminderStage } from './rental-platform-billing.util';

export interface PlatformInvoiceEmailFacts {
  invoiceNumber: string;
  kind: PlatformInvoiceKind;
  invoiceMonth: string; // '2026-11'
  periodStart: Date;
  periodEnd: Date;
  planName: string;
  occupiedUnits: number;
  matchedRentTotal: number | null;
  amountDue: number;
  dueDate: Date;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: Date) => d.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' });
const monthName = (m: string) => {
  const [year, month] = m.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

function describe(inv: PlatformInvoiceEmailFacts): string {
  return inv.kind === 'COLLECTION_FEE'
    ? `our 1% fee on the rent collected through your payment gateway in ${monthName(inv.invoiceMonth)}`
    : `your ${inv.planName} plan`;
}

const HEADLINES: Record<PlatformReminderStage, (inv: PlatformInvoiceEmailFacts) => { subject: string; lead: string; urgent: boolean }> = {
  1: (inv) => ({
    subject: `Your Zaroda rentals invoice ${inv.invoiceNumber}`,
    lead: `Here is your Zaroda rentals invoice for ${describe(inv)}. It is due on ${date(inv.dueDate)}.`,
    urgent: false,
  }),
  2: (inv) => ({
    subject: `Reminder: rentals invoice ${inv.invoiceNumber} is due ${date(inv.dueDate)}`,
    lead: `A reminder that your Zaroda rentals invoice ${inv.invoiceNumber} is due on ${date(inv.dueDate)}. Paying on time keeps your account fully open.`,
    urgent: false,
  }),
  3: (inv) => ({
    subject: `Final reminder: rentals invoice ${inv.invoiceNumber} is due ${date(inv.dueDate)}`,
    lead: `Your Zaroda rentals invoice ${inv.invoiceNumber} is still unpaid and is due on ${date(inv.dueDate)}. If it is not paid by then your rentals account becomes read-only: you will still see everything, but you will not be able to make changes until it is paid.`,
    urgent: true,
  }),
  4: (inv) => ({
    subject: `Your rentals account is now read-only - invoice ${inv.invoiceNumber} unpaid`,
    lead: `Because invoice ${inv.invoiceNumber} was due on ${date(inv.dueDate)} and is unpaid, your rentals account is now read-only. Nothing has been deleted: all your records are safe and visible, and tenants can still pay you. Editing opens up again as soon as the invoice is paid.`,
    urgent: true,
  }),
};

/** The invoice email at a given stage. `payUrl` is where the landlord goes to see and pay the invoice. */
export function buildPlatformInvoiceEmail(stage: PlatformReminderStage, invoice: PlatformInvoiceEmailFacts, businessName: string, payUrl: string | null): BuiltEmail {
  const { subject, lead, urgent } = HEADLINES[stage](invoice);
  const accent = urgent ? '#b91c1c' : BRAND.NAVY;
  const rows =
    invoice.kind === 'COLLECTION_FEE'
      ? `<tr><td style="padding:6px 0;color:#64748b">Rent collected through your gateway</td><td style="text-align:right">${escapeHtml(money(invoice.matchedRentTotal ?? 0))}</td></tr>`
      : `<tr><td style="padding:6px 0;color:#64748b">Covers</td><td style="text-align:right">${escapeHtml(date(invoice.periodStart))} to ${escapeHtml(date(new Date(invoice.periodEnd.getTime() - 1000)))}</td></tr>`;
  const button = payUrl ? `<p style="text-align:center;margin:24px 0">${brandButton('View invoice', payUrl, urgent ? accent : undefined)}</p>` : '';
  const html = brandedEmail({
    title: 'Zaroda rentals invoice',
    maxWidth: 560,
    accent: urgent ? accent : undefined,
    bodyHtml: `
        <p>Hello ${escapeHtml(businessName)},</p>
        <p>${escapeHtml(lead)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <tr><td style="padding:6px 0;color:#64748b">Invoice</td><td style="text-align:right"><b>${escapeHtml(invoice.invoiceNumber)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Plan</td><td style="text-align:right">${escapeHtml(invoice.planName)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Occupied units on the 1st</td><td style="text-align:right">${invoice.occupiedUnits}</td></tr>
          ${rows}
          <tr><td style="padding:6px 0;color:#64748b">Amount to pay</td><td style="text-align:right"><b>${escapeHtml(money(invoice.amountDue))}</b></td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Due date</td><td style="text-align:right">${escapeHtml(date(invoice.dueDate))}</td></tr>
        </table>
        ${button}
        <p style="font-size:12px;color:#64748b">Your tenants&apos; rent always goes straight to your own account; Zaroda never holds it. Already paid? Thank you - you can ignore this email.</p>`,
  });
  const text = `${lead}\n\nInvoice ${invoice.invoiceNumber}\nPlan: ${invoice.planName}\nOccupied units on the 1st: ${invoice.occupiedUnits}\nAmount to pay: ${money(invoice.amountDue)}\nDue: ${date(invoice.dueDate)}\n${payUrl ? `\nView invoice: ${payUrl}\n` : ''}`;
  return { subject, html, text };
}

/** Sent once an invoice is settled (online, or recorded by Zaroda for a bank or cash payment). */
export function buildPlatformReceiptEmail(invoice: PlatformInvoiceEmailFacts, businessName: string, reference: string | null): BuiltEmail {
  const subject = `Payment received - rentals invoice ${invoice.invoiceNumber}`;
  const lead = `Thank you - we received ${money(invoice.amountDue)} for rentals invoice ${invoice.invoiceNumber}.${reference ? ` Reference: ${reference}.` : ''}`;
  const html = brandedEmail({
    title: 'Payment received',
    maxWidth: 560,
    accent: '#15803d',
    bodyHtml: `
        <p>Hello ${escapeHtml(businessName)},</p>
        <p>${escapeHtml(lead)}</p>
        <p style="font-size:12px;color:#64748b">Your rentals account is fully open. Keep this email as your receipt.</p>`,
  });
  return { subject, html, text: lead };
}
