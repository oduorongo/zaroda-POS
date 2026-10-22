import { Injectable, Logger } from '@nestjs/common';
import { brandedEmail } from '../common/email/brand-layout';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';

export interface Recipient {
  name: string;
  phone: string; // 2547XXXXXXXX
  email: string | null;
}

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Tells a school's contact person about their order, invoice or payment: a text first (it reaches where an email may not),
 * and the email as well when the school has one. Called AFTER the work is saved and never allowed to fail it - a message
 * nobody receives must not undo a delivery or a receipt. Safaricom numbers cannot be texted yet (no sender ID), so for
 * those the email, if any, is what arrives; otherwise the school sees it in the portal.
 */
@Injectable()
export class SchoolNotifierService {
  private readonly logger = new Logger(SchoolNotifierService.name);

  constructor(
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly email: ResendEmailProvider,
  ) {}

  async notify(to: Recipient, supplierName: string, subject: string, message: string): Promise<void> {
    try {
      await this.sms.sendSms({ to: `+${to.phone}`, message: `${supplierName}: ${message}`.slice(0, 300) }).catch(() => ({ sent: false }));
      if (to.email && this.email.isConfigured()) {
        await this.email.sendEmail({
          to: to.email,
          subject,
          html: brandedEmail({ title: supplierName, bodyHtml: `<p>Hello ${escapeHtml(to.name)},</p><p>${escapeHtml(message)}</p>` }),
          text: `${message}`,
        });
      }
    } catch (e) {
      this.logger.error({ err: e }, 'Could not notify a school');
    }
  }
}
