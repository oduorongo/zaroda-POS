import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationProvider,
  SendSmsResult,
} from './notification-provider.interface';

/**
 * Africa's Talking SMS (DESIGN.md §7's named choice for Kenya). Implemented
 * against the published API spec but NOT YET LIVE-TESTED - this
 * environment has no Africa's Talking account/API key, the identical
 * situation MpesaPaymentProcessor documents for Daraja. Cash/in-app flows
 * were built and verified first everywhere in this project; this is the
 * same "the interface and call site are real and wired in, the actual
 * provider credentials are the piece deferred until they exist" pattern,
 * not a shortcut specific to notifications.
 *
 * Required env: AFRICAS_TALKING_API_KEY, AFRICAS_TALKING_USERNAME.
 * AFRICAS_TALKING_ENV=production switches off the sandbox host; defaults
 * to sandbox. Unlike MpesaPaymentProcessor, missing config does NOT
 * throw - see SendSmsResult's own comment on why a notification must
 * degrade gracefully rather than take down the caller's real work.
 */
@Injectable()
export class AfricasTalkingSmsProvider implements NotificationProvider {
  private readonly logger = new Logger(AfricasTalkingSmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('AFRICAS_TALKING_ENV') === 'production'
      ? 'https://api.africastalking.com/version1/messaging'
      : 'https://api.sandbox.africastalking.com/version1/messaging';
  }

  async sendSms(input: {
    to: string;
    message: string;
  }): Promise<SendSmsResult> {
    const apiKey = this.config.get<string>('AFRICAS_TALKING_API_KEY');
    const username = this.config.get<string>('AFRICAS_TALKING_USERNAME');
    if (!apiKey || !username) {
      this.logger.warn(
        "Africa's Talking is not configured (AFRICAS_TALKING_API_KEY/USERNAME missing) - SMS not sent, continuing without it.",
      );
      return { sent: false };
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          username,
          to: input.to,
          message: input.message,
        }).toString(),
      });
      if (!response.ok) {
        this.logger.error(
          `Africa's Talking send failed: ${response.status} ${await response.text()}`,
        );
        return { sent: false };
      }
      const body = (await response.json()) as {
        SMSMessageData?: {
          Recipients?: { messageId?: string; status?: string }[];
        };
      };
      const recipient = body.SMSMessageData?.Recipients?.[0];
      if (!recipient || recipient.status !== 'Success') {
        this.logger.error(
          `Africa's Talking rejected the message: ${JSON.stringify(body)}`,
        );
        return { sent: false };
      }
      return { sent: true, providerReference: recipient.messageId };
    } catch (err) {
      // Network failure, malformed response, etc. - same "never let a
      // notification provider outage take down the caller's real work"
      // principle, just at the transport level instead of "not
      // configured."
      this.logger.error(
        `Africa's Talking send threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { sent: false };
    }
  }
}
