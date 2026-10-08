import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Talks to TUMA (tuma.co.ke) on behalf of ONE business, using that
 * business's own merchant credentials - every call takes email/apiKey as
 * arguments rather than reading a platform-wide env var, because under the
 * marketplace's payment model each business collects into its own TUMA
 * account (see the OnlineStore schema comment). Contrast
 * MpesaPaymentProcessor, which uses a single platform shortcode.
 *
 * Only credential verification exists so far; STK push and payment
 * status lookups arrive with online checkout.
 */
@Injectable()
export class TumaClient {
  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (this.config.get<string>('TUMA_BASE_URL') ?? 'https://api.tuma.co.ke').replace(/\/+$/, '');
  }

  /**
   * Exchanges a merchant's email + API key for a token (POST /auth/token).
   * Used to reject a mistyped key at save time, instead of the business
   * finding out when its first buyer's payment fails.
   */
  async verifyCredentials(email: string, apiKey: string): Promise<void> {
    await this.getToken(email, apiKey);
  }

  /**
   * Sends an M-Pesa prompt to the buyer's phone; the money settles into
   * the business's own TUMA account. The outcome arrives later at
   * callbackUrl (TUMA has no status-lookup endpoint - see
   * OnlineOrdersService.handleTumaCallback for how callbacks are trusted).
   */
  async stkPush(
    credentials: { email: string; apiKey: string },
    input: { amount: number; phone: string; description: string; callbackUrl: string },
  ): Promise<{ paymentId: string }> {
    const token = await this.getToken(credentials.email, credentials.apiKey);
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
      throw new ServiceUnavailableException('Could not reach the payment service - try again in a moment');
    }
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      data?: { payment_id?: unknown };
    };
    if (!response.ok || typeof body.data?.payment_id !== 'string') {
      if (response.status >= 500 || response.ok) {
        throw new ServiceUnavailableException('The payment service is unavailable right now - try again in a moment');
      }
      throw new BadRequestException(`Payment could not be started: ${body.message ?? response.status}`);
    }
    return { paymentId: body.data.payment_id };
  }

  private async getToken(email: string, apiKey: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, api_key: apiKey }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceUnavailableException('Could not reach TUMA - try again in a moment');
    }
    if (response.status >= 500) {
      throw new ServiceUnavailableException('TUMA is unavailable right now - try again in a moment');
    }
    // TUMA's docs show `token` at the top level; `data.token` is accepted
    // too in case it's wrapped like the STK push response is.
    const body = (await response.json().catch(() => ({}))) as { token?: unknown; data?: { token?: unknown } };
    const token = body.token ?? body.data?.token;
    if (!response.ok || typeof token !== 'string' || !token) {
      throw new BadRequestException('TUMA rejected these credentials - check the email and API key');
    }
    return token;
  }
}
