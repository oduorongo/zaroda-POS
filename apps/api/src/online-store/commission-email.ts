import { BRAND, brandButton, brandedEmail } from '../common/email/brand-layout';
import { pauseDate } from './commission.util';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A "payment due soon" reminder goes out this many days before the due date. */
export const DUE_SOON_DAYS = 3;

/**
 * 1 issued, 2 due soon, 3 overdue, 4 shop hidden. Each stage is emailed at
 * most once (CommissionInvoice.reminderStage records the furthest sent), so
 * the daily run can fire as often as it likes. If the server was down for
 * weeks the invoice jumps straight to the stage it has reached, rather than
 * replaying every earlier notice.
 */
export type ReminderStage = 1 | 2 | 3 | 4;

interface StageInvoice {
  status: 'ISSUED' | 'PAID' | 'WAIVED';
  dueDate: Date;
  reminderStage: number;
}

/** The notice that should be sent now for this invoice, or null if there's nothing new to say. */
export function nextReminderStage(invoice: StageInvoice, now: Date = new Date()): ReminderStage | null {
  if (invoice.status !== 'ISSUED') return null;
  let stage: ReminderStage = 1;
  if (now.getTime() >= invoice.dueDate.getTime() - DUE_SOON_DAYS * DAY_MS) stage = 2;
  if (now >= invoice.dueDate) stage = 3;
  if (now >= pauseDate(invoice.dueDate)) stage = 4;
  return stage > invoice.reminderStage ? stage : null;
}

export interface EmailInvoice {
  invoiceNumber: string;
  periodMonth: string;
  orderCount: number;
  salesTotal: number;
  commissionTotal: number;
  amountDue: number;
  dueDate: Date;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: Date) => d.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' });

const monthName = (periodMonth: string) => {
  const [year, month] = periodMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const HEADLINES: Record<ReminderStage, (inv: EmailInvoice) => { subject: string; lead: string; urgent: boolean }> = {
  1: (inv) => ({
    subject: `Your Zaroda commission invoice ${inv.invoiceNumber} - ${monthName(inv.periodMonth)}`,
    lead: `Here is your Zaroda commission invoice for online orders completed in ${monthName(inv.periodMonth)}. It is due on ${date(inv.dueDate)}.`,
    urgent: false,
  }),
  2: (inv) => ({
    subject: `Reminder: commission invoice ${inv.invoiceNumber} is due ${date(inv.dueDate)}`,
    lead: `Your commission invoice ${inv.invoiceNumber} is due on ${date(inv.dueDate)}. Paying now keeps your online shop open without interruption.`,
    urgent: false,
  }),
  3: (inv) => ({
    subject: `Overdue: commission invoice ${inv.invoiceNumber}`,
    lead: `Your commission invoice ${inv.invoiceNumber} was due on ${date(inv.dueDate)} and has not been paid. Please pay it now - if it stays unpaid for another few days your online shop will be hidden from buyers.`,
    urgent: true,
  }),
  4: (inv) => ({
    subject: `Your online shop is hidden - commission invoice ${inv.invoiceNumber} unpaid`,
    lead: `Because commission invoice ${inv.invoiceNumber} is still unpaid, buyers can no longer see your online shop or place new orders. Orders already placed are not affected. It reappears automatically the moment the invoice is paid.`,
    urgent: true,
  }),
};

/** The invoice email at a given stage. `payUrl` goes to the page where the business pays online. */
export function buildInvoiceEmail(stage: ReminderStage, invoice: EmailInvoice, shopName: string, payUrl: string | null): BuiltEmail {
  const { subject, lead, urgent } = HEADLINES[stage](invoice);
  const shop = escapeHtml(shopName);
  const accent = urgent ? '#b91c1c' : BRAND.NAVY;
  const button = payUrl
    ? `<p style="text-align:center;margin:24px 0">${brandButton(`Pay ${money(invoice.amountDue)} with M-Pesa`, payUrl, urgent ? accent : undefined)}</p>`
    : '';
  const html = brandedEmail({
    title: 'Zaroda commission invoice',
    maxWidth: 560,
    accent: urgent ? accent : undefined,
    bodyHtml: `
        <p>Hello ${shop},</p>
        <p>${escapeHtml(lead)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <tr><td style="padding:6px 0;color:#64748b">Invoice</td><td style="text-align:right"><b>${escapeHtml(invoice.invoiceNumber)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Period</td><td style="text-align:right">${escapeHtml(monthName(invoice.periodMonth))}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Completed orders and room bookings</td><td style="text-align:right">${invoice.orderCount}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Sales total</td><td style="text-align:right">${escapeHtml(money(invoice.salesTotal))}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Commission</td><td style="text-align:right">${escapeHtml(money(invoice.commissionTotal))}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Amount to pay (rounded up to a whole shilling)</td><td style="text-align:right"><b>${escapeHtml(money(invoice.amountDue))}</b></td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Due date</td><td style="text-align:right">${escapeHtml(date(invoice.dueDate))}</td></tr>
        </table>
        ${button}
        <p style="font-size:12px;color:#64748b">You can also pay from <b>Online Shop settings</b> in your Zaroda back office. Already paid? Thank you - you can ignore this email.</p>`,
  });
  const text = `${lead}\n\nInvoice ${invoice.invoiceNumber} (${monthName(invoice.periodMonth)})\nOrders and bookings: ${invoice.orderCount}\nCommission: ${money(invoice.commissionTotal)}\nAmount to pay: ${money(invoice.amountDue)}\nDue: ${date(invoice.dueDate)}\n${payUrl ? `\nPay online: ${payUrl}\n` : ''}`;
  return { subject, html, text };
}

/** Sent once an invoice is settled online. */
export function buildReceiptEmail(invoice: EmailInvoice, shopName: string, mpesaReceipt: string | null, shopIsHidden: boolean): BuiltEmail {
  const subject = `Payment received - commission invoice ${invoice.invoiceNumber}`;
  const lead = `Thank you - we received ${money(invoice.amountDue)} for commission invoice ${invoice.invoiceNumber} (${monthName(invoice.periodMonth)}).${mpesaReceipt ? ` M-Pesa receipt: ${mpesaReceipt}.` : ''}${shopIsHidden ? '' : ''}`;
  const html = brandedEmail({
    title: 'Payment received',
    maxWidth: 560,
    accent: '#15803d',
    bodyHtml: `
        <p>Hello ${escapeHtml(shopName)},</p>
        <p>${escapeHtml(lead)}</p>
        <p style="font-size:12px;color:#64748b">Your online shop stays open for buyers. Keep this email as your receipt.</p>`,
  });
  return { subject, html, text: lead };
}

// ── Daily shopper-fee notices ────────────────────────────────────────────

export interface FeeEmailInvoice {
  invoiceNumber: string;
  amountDue: number;
  orderCount: number;
}

const FEE_LEAD: Record<ReminderStage, (inv: FeeEmailInvoice) => { subject: string; lead: string; urgent: boolean }> = {
  1: (inv) => ({
    subject: `Send KES ${inv.amountDue.toLocaleString('en-KE')} to Zaroda - today's shopper fees`,
    lead: `Your shoppers paid KES ${inv.amountDue.toLocaleString('en-KE')} in convenience fees on ${inv.orderCount} ${inv.orderCount === 1 ? 'order' : 'orders'}. You collected it with their payments; please send it to Zaroda now by M-Pesa.`,
    urgent: false,
  }),
  2: (inv) => ({
    subject: `Reminder: send KES ${inv.amountDue.toLocaleString('en-KE')} in shopper fees to Zaroda`,
    lead: `Yesterday's shopper fees (KES ${inv.amountDue.toLocaleString('en-KE')}) have not reached Zaroda yet. Please send them today.`,
    urgent: false,
  }),
  3: (inv) => ({
    subject: `Last reminder: send KES ${inv.amountDue.toLocaleString('en-KE')} to Zaroda or your shop will be hidden`,
    lead: `Shopper fees of KES ${inv.amountDue.toLocaleString('en-KE')} are still unsent. If they are not sent by tomorrow your online shop will be hidden from buyers.`,
    urgent: true,
  }),
  4: (inv) => ({
    subject: `Your online shop is hidden - KES ${inv.amountDue.toLocaleString('en-KE')} in shopper fees unsent`,
    lead: `Because KES ${inv.amountDue.toLocaleString('en-KE')} in shopper fees is still unsent, buyers can no longer see your shop or place new orders. Orders already placed are not affected. It reappears the moment the fees are sent.`,
    urgent: true,
  }),
};

export function buildFeeNoticeEmail(stage: ReminderStage, invoice: FeeEmailInvoice, shopName: string, payUrl: string | null): BuiltEmail {
  const { subject, lead, urgent } = FEE_LEAD[stage](invoice);
  const accent = urgent ? '#b91c1c' : BRAND.NAVY;
  const button = payUrl ? `<p style="text-align:center;margin:24px 0">${brandButton(`Send KES ${invoice.amountDue.toLocaleString('en-KE')} with M-Pesa`, payUrl, urgent ? accent : undefined)}</p>` : '';
  const html = brandedEmail({
    title: 'Shopper fees to send to Zaroda',
    maxWidth: 560,
    accent: urgent ? accent : undefined,
    bodyHtml: `
        <p>Hello ${escapeHtml(shopName)},</p>
        <p>${escapeHtml(lead)}</p>
        <p style="font-size:14px;color:#64748b">Reference ${escapeHtml(invoice.invoiceNumber)}. This is money your shoppers paid as a convenience fee - it is not a charge to you, and you pay no commission on these orders.</p>
        ${button}
        <p style="font-size:12px;color:#64748b">You can also send it from <b>Online Shop settings</b> in your Zaroda back office. Already sent? Thank you - you can ignore this email.</p>`,
  });
  return { subject, html, text: `${lead}\n\nReference ${invoice.invoiceNumber}${payUrl ? `\nSend it here: ${payUrl}` : ''}` };
}

/** The same notice as a text message (kept short). */
export function feeNoticeSms(stage: ReminderStage, amountDue: number): string {
  const kes = `KES ${amountDue.toLocaleString('en-KE')}`;
  if (stage === 1) return `Zaroda: your shoppers paid ${kes} in fees today. Please send it to Zaroda: open Online shop settings in your back office and tap Send.`;
  if (stage === 2) return `Zaroda reminder: ${kes} in shopper fees has not been sent. Please send it today (Online shop settings).`;
  if (stage === 3) return `Zaroda: last reminder. Send ${kes} in shopper fees by tomorrow or your online shop will be hidden.`;
  return `Zaroda: your online shop is hidden until the ${kes} in shopper fees is sent. Open Online shop settings to send it.`;
}
