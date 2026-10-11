import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentConfirmation,
  jwtExpiryMs,
  judgePayment,
  parseStatusResponse,
  parseStkResponse,
} from './tuma.util';

export interface TumaCredentials {
  email: string;
  apiKey: string;
}

/**
 * Talks to Tuma (tuma.co.ke). Every call takes the credentials to use:
 * - a BUSINESS's own Tuma account, for its buyers' order payments (each
 *   business collects into its own account - see the OnlineStore schema
 *   comment), or
 * - ZARODA's platform account (platformCredentials(), env TUMA_EMAIL /
 *   TUMA_API_KEY - the same account the school system collects
 *   subscriptions with), for businesses paying their commission invoices.
 *
 * Tokens are cached per account email until shortly before they expire.
 */
@Injectable()
export class TumaClient {
  private readonly logger = new Logger(TumaClient.name);
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (this.config.get<string>('TUMA_BASE_URL') ?? 'https://api.tuma.co.ke').replace(/\/+$/, '');
  }

  /** ZARODA's own Tuma account, or a clear 503 if it isn't set up on this server. */
  platformCredentials(): TumaCredentials {
    const email = this.config.get<string>('TUMA_EMAIL');
    const apiKey = this.config.get<string>('TUMA_API_KEY');
    if (!email || !apiKey) {
      throw new ServiceUnavailableException('Online payment of invoices is not set up yet - please contact Zaroda');
    }
    return { email, apiKey };
  }

  hasPlatformCredentials(): boolean {
    return Boolean(this.config.get<string>('TUMA_EMAIL') && this.config.get<string>('TUMA_API_KEY'));
  }

  /**
   * Exchanges email + API key for a token (POST /auth/token). Also used to
   * reject a mistyped key at save time, instead of the business finding
   * out when its first buyer's payment fails.
   */
  async verifyCredentials(email: string, apiKey: string): Promise<void> {
    await this.getToken({ email, apiKey }, { fresh: true });
  }

  /**
   * Sends an M-Pesa prompt to `phone`; the money settles into the account
   * `credentials` belong to. The outcome arrives later at callbackUrl, but
   * a callback is only a prompt to call checkStatus - it never settles
   * anything by itself.
   */
  async stkPush(
    credentials: TumaCredentials,
    input: { amount: number; phone: string; description: string; callbackUrl: string },
  ): Promise<{ merchantRequestId: string }> {
    // Cloudflare-fronted 5xx (a 522 timeout is the one seen in the school
    // system's production) is a transient blip on Tuma's side - one retry
    // clears most of them without the buyer re-entering anything.
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getToken(credentials);
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/payment/stk-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            amount: input.amount,
            phone: input.phone,
            description: input.description.slice(0, 255),
            callback_url: input.callbackUrl,
          }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        if (attempt === 0) continue;
        throw new ServiceUnavailableException('Could not reach the payment service - try again in a moment');
      }
      const body = (await response.json().catch(() => ({}))) as { message?: unknown };
      if (response.status >= 500) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        throw new ServiceUnavailableException('The payment service is unavailable right now - try again in a moment');
      }
      const { merchantRequestId } = parseStkResponse(body);
      if (!response.ok || !merchantRequestId) {
        const detail = Array.isArray(body.message) ? body.message.join(', ') : typeof body.message === 'string' ? body.message : response.status;
        throw new BadRequestException(`Payment could not be started: ${detail}`);
      }
      return { merchantRequestId };
    }
    throw new ServiceUnavailableException('Could not reach the payment service - try again in a moment');
  }

  /**
   * Asks Tuma whether a payment really went through, and for how much.
   * Only a 'paid' outcome may settle anything.
   *
   * THIS COSTS KES 1 PER CALL (Tuma's status endpoint is paid; its webhooks
   * are free), charged to the account whose credentials are passed. So it is
   * only ever used as a backup - when a callback was incomplete, or when
   * someone explicitly asks "check now" - never in a polling loop.
   *
   * Never throws on a Tuma-side failure: 'unconfirmed' means Tuma answered
   * "not paid (yet)", 'unavailable' means it couldn't answer at all.
   */
  async confirmPayment(
    credentials: TumaCredentials,
    merchantRequestId: string,
    expectedAmount: number,
  ): Promise<PaymentConfirmation> {
    try {
      const token = await this.getToken(credentials);
      const response = await fetch(`${this.baseUrl}/payment/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ merchant_request_id: merchantRequestId }),
        signal: AbortSignal.timeout(15_000),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          outcome: 'unavailable',
          detail: response.status === 402 ? 'Tuma says this account has no credits left for status checks' : `Tuma status check failed (${response.status})`,
        };
      }
      return judgePayment(parseStatusResponse(body), expectedAmount);
    } catch (e) {
      this.logger.warn({ err: e, merchantRequestId }, 'Tuma status check failed');
      return { outcome: 'unavailable', detail: 'Could not reach Tuma to confirm the payment' };
    }
  }

  private async getToken(credentials: TumaCredentials, opts: { fresh?: boolean } = {}): Promise<string> {
    const cached = this.tokenCache.get(credentials.email);
    if (!opts.fresh && cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: credentials.email, api_key: credentials.apiKey }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceUnavailableException('Could not reach Tuma - try again in a moment');
    }
    if (response.status >= 500) {
      throw new ServiceUnavailableException('Tuma is unavailable right now - try again in a moment');
    }
    // TUMA's docs show `token` at the top level; `data.token` is accepted
    // too in case it's wrapped like the STK push response is.
    const body = (await response.json().catch(() => ({}))) as {
      token?: unknown;
      access_token?: unknown;
      data?: { token?: unknown; access_token?: unknown };
    };
    const token = body.token ?? body.access_token ?? body.data?.token ?? body.data?.access_token;
    if (!response.ok || typeof token !== 'string' || !token) {
      throw new BadRequestException('Tuma rejected these credentials - check the email and API key');
    }
    // Their sample tokens last 24h; assume 23h when expiry can't be read.
    this.tokenCache.set(credentials.email, { token, expiresAt: jwtExpiryMs(token) ?? Date.now() + 23 * 60 * 60 * 1000 });
    return token;
  }
}
