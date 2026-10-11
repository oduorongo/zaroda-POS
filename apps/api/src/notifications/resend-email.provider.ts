import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendEmailResult {
  /** False whenever the provider isn't configured or the send failed - never throws, same reasoning as SendSmsResult. */
  sent: boolean;
  detail?: string;
}

/**
 * Email through Resend (resend.com) - the same provider and the same two
 * environment variables as the ZARODA school system (RESEND_API_KEY,
 * RESEND_FROM), so one account and one verified sending domain serve both.
 * Note Resend's free plan allows 100 emails a day across everything sent
 * with that key.
 *
 * Like AfricasTalkingSmsProvider, a missing key doesn't break anything:
 * the send just reports { sent: false } and the caller carries on - an
 * email is a courtesy on top of work that has already been saved.
 */
@Injectable()
export class ResendEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('RESEND_API_KEY'));
  }

  async sendEmail(input: { to: string; subject: string; html: string; text?: string }): Promise<SendEmailResult> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('Resend is not configured (RESEND_API_KEY missing) - email not sent, continuing without it.');
      return { sent: false, detail: 'Email not configured' };
    }
    const from = this.config.get<string>('RESEND_FROM') ?? 'ZARODA <onboarding@resend.dev>';
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text ?? input.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const body = (await response.text().catch(() => '')).slice(0, 200);
        this.logger.error(`Resend send failed: ${response.status} ${body}`);
        return { sent: false, detail: `Resend error ${response.status}` };
      }
      return { sent: true };
    } catch (e) {
      this.logger.error({ err: e }, 'Resend send failed');
      return { sent: false, detail: 'Could not reach Resend' };
    }
  }
}
