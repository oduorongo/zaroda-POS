import { Injectable, Logger } from '@nestjs/common';
import { brandButton, brandedEmail } from '../common/email/brand-layout';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';

export interface Recipient {
  name: string;
  phone: string; // 2547XXXXXXXX
  email: string | null;
}

/** Extra content for the email only (the text message stays short): a table of what was delivered, and a button to the portal. */
export interface EmailExtras {
  /** Already-safe HTML (built with `detailTable`). */
  detailHtml?: string;
  link?: { label: string; url: string };
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A small table for an email: a header row, then rows of cells (all escaped here). Numbers line up to the right. */
export function detailTable(head: string[], rows: string[][]): string {
  const cell = (v: string, i: number, tag: 'td' | 'th') =>
    `<${tag} style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:${i === 0 ? 'left' : 'right'};font-size:13px">${escapeHtml(v)}</${tag}>`;
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0"><thead><tr>${head.map((h, i) => cell(h, i, 'th')).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => cell(c, i, 'td')).join('')}</tr>`).join('')}</tbody></table>`;
}

/**
 * Tells a school's contact person about their order, invoice or payment: a text first (it reaches where an email may not),
 * and the email as well when the school has one. Called AFTER the work is saved and never allowed to fail it - a message
 * nobody receives must not undo a delivery or a receipt. Safaricom numbers cannot be texted yet (no sender ID), so for
 * those the email, if any, is what arrives; otherwise the school sees it in the portal.
 *
 * The supplier's own people get an email too (`notifyStaff`) when a school orders, cancels or confirms receipt.
 */
@Injectable()
export class SchoolNotifierService {
  private readonly logger = new Logger(SchoolNotifierService.name);

  constructor(
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly email: ResendEmailProvider,
  ) {}

  private body(name: string, message: string, extras?: EmailExtras): string {
    return `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p>${extras?.detailHtml ?? ''}${extras?.link ? `<p style="margin-top:16px">${brandButton(extras.link.label, extras.link.url)}</p>` : ''}`;
  }

  async notify(
    to: Recipient,
    supplierName: string,
    subject: string,
    message: string,
    extras?: EmailExtras,
  ): Promise<void> {
    try {
      await this.sms
        .sendSms({
          to: `+${to.phone}`,
          message: `${supplierName}: ${message}`.slice(0, 300),
        })
        .catch(() => ({ sent: false }));
      if (to.email && this.email.isConfigured()) {
        await this.email.sendEmail({
          to: to.email,
          subject,
          html: brandedEmail({
            title: supplierName,
            bodyHtml: this.body(to.name, message, extras),
          }),
          text: `${message}${extras?.link ? `\n${extras.link.url}` : ''}`,
        });
      }
    } catch (e) {
      this.logger.error({ err: e }, 'Could not notify a school');
    }
  }

  /** An email to the supplier's own people (owner, managers, the business address). Never fails the work it follows. */
  async notifyStaff(
    emails: string[],
    businessName: string,
    subject: string,
    message: string,
    extras?: EmailExtras,
  ): Promise<void> {
    try {
      if (!this.email.isConfigured()) return;
      for (const to of Array.from(new Set(emails.filter(Boolean)))) {
        await this.email
          .sendEmail({
            to,
            subject,
            html: brandedEmail({
              title: businessName,
              bodyHtml: `<p>${escapeHtml(message)}</p>${extras?.detailHtml ?? ''}${extras?.link ? `<p style="margin-top:16px">${brandButton(extras.link.label, extras.link.url)}</p>` : ''}`,
            }),
            text: `${message}${extras?.link ? `\n${extras.link.url}` : ''}`,
          })
          .catch(() => undefined);
      }
    } catch (e) {
      this.logger.error({ err: e }, 'Could not email the supplier');
    }
  }
}
