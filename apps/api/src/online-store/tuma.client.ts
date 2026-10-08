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
    const body = (await response.json().catch(() => ({}))) as { token?: unknown };
    if (!response.ok || typeof body.token !== 'string' || !body.token) {
      throw new BadRequestException('TUMA rejected these credentials - check the email and API key');
    }
  }
}
