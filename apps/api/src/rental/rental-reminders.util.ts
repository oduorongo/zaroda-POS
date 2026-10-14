import { BRAND, brandedEmail } from '../common/email/brand-layout';

export type ReminderStage = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'FINAL';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which reminder an unpaid invoice is due for today, if any. Each stage is a window of days, and a stage is only ever
 * sent once per invoice (the log enforces that), so a missed hourly run is simply caught up the next time.
 *   1-3 days before the due date  -> UPCOMING (a friendly heads-up)
 *   due day up to 2 days late     -> DUE
 *   3-9 days late                 -> OVERDUE
 *   10-60 days late               -> FINAL (one last firm notice, then we stop - the landlord should call)
 */
export function reminderStage(dueDate: Date, today: Date): ReminderStage | null {
  const days = Math.round((dueDate.getTime() - today.getTime()) / DAY_MS);
  if (days >= 1 && days <= 3) return 'UPCOMING';
  if (days <= 0 && days > -3) return 'DUE';
  if (days <= -3 && days > -10) return 'OVERDUE';
  if (days <= -10 && days >= -60) return 'FINAL';
  return null;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (v: number) => v.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dateText = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export interface ReminderFacts {
  business: string;
  tenantName: string;
  property: string;
  unit: string;
  description: string; // e.g. "Rent for October 2026"
  amount: number; // what is outstanding on this invoice
  totalBalance: number; // everything the tenant owes
  dueDate: Date;
  stage: ReminderStage | 'MANUAL';
  instructions?: string | null;
}

function headline(f: ReminderFacts): string {
  switch (f.stage) {
    case 'UPCOMING':
      return `Rent is due on ${dateText(f.dueDate)}`;
    case 'DUE':
      return 'Rent is due now';
    case 'OVERDUE':
      return 'Your rent is overdue';
    case 'FINAL':
      return 'Final reminder: rent still unpaid';
    default:
      return 'Rent balance reminder';
  }
}

export function buildReminderEmail(f: ReminderFacts): { subject: string; html: string; text: string } {
  const unitLine = `${f.property} - ${f.unit}`;
  const overdue = f.stage === 'OVERDUE' || f.stage === 'FINAL';
  const subject = `${headline(f)} - ${unitLine}`;
  const lines = [
    `Dear ${f.tenantName},`,
    `${f.description} for ${unitLine}: KES ${money(f.amount)} (due ${dateText(f.dueDate)}).`,
    f.totalBalance > f.amount + 0.009 ? `Your total balance is KES ${money(f.totalBalance)}.` : '',
    f.instructions ? `How to pay: ${f.instructions}` : '',
    'If you have already paid, thank you - please ignore this message.',
    f.business,
  ].filter(Boolean);
  const html = brandedEmail({
    title: headline(f),
    accent: overdue ? '#b91c1c' : BRAND.GOLD,
    bodyHtml: `
      <p style="margin:0 0 12px">Dear ${esc(f.tenantName)},</p>
      <p style="margin:0 0 12px">${esc(f.description)} for <strong>${esc(unitLine)}</strong>:</p>
      <p style="margin:0 0 12px;font-size:22px;font-weight:bold">KES ${esc(money(f.amount))}</p>
      <p style="margin:0 0 12px;color:#475569">Due ${esc(dateText(f.dueDate))}${f.totalBalance > f.amount + 0.009 ? ` · total balance KES ${esc(money(f.totalBalance))}` : ''}</p>
      ${f.instructions ? `<p style="margin:0 0 12px"><strong>How to pay:</strong> ${esc(f.instructions)}</p>` : ''}
      <p style="margin:0 0 12px;color:#475569">If you have already paid, thank you - please ignore this message.</p>
      <p style="margin:0">${esc(f.business)}</p>`,
  });
  return { subject, html, text: lines.join('\n\n') };
}

/** Short enough for one or two SMS segments. */
export function buildReminderSms(f: ReminderFacts): string {
  const head =
    f.stage === 'OVERDUE' || f.stage === 'FINAL'
      ? `Hi ${f.tenantName.split(' ')[0]}, your rent for ${f.unit} is overdue`
      : `Hi ${f.tenantName.split(' ')[0]}, rent for ${f.unit} is due ${dateText(f.dueDate)}`;
  return `${head}: KES ${money(f.totalBalance > f.amount ? f.totalBalance : f.amount)}.${f.instructions ? ` Pay: ${f.instructions}.` : ''} - ${f.business}`.slice(0, 300);
}
