import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DarajaQueryOutcome, darajaPassword, darajaTimestamp, parseDarajaQuery, stkAccountFields } from './daraja.util';

/** A business's own Daraja app, decrypted for the length of one call. */
export interface DarajaCredentials {
  environment: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  accountType: string | null;
  shortcode: string;
  tillNumber: string | null;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Talks to Safaricom's Daraja API with a BUSINESS's own credentials, so buyers pay straight into that
 * business's Paybill or Till. Tokens are cached per consumer key until shortly before they expire.
 */
@Injectable()
export class DarajaClient {
  private readonly logger = new Logger(DarajaClient.name);
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  /** DARAJA_BASE_URL lets a test server stand in for Safaricom. */
  private baseUrl(environment: string): string {
    const override = this.config.get<string>('DARAJA_BASE_URL');
    if (override) return override.replace(/\/+$/, '');
    return environment === 'sandbox' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
  }

  private async post(url: string, token: string, body: unknown): Promise<{ status: number; json: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json: unknown = await response.json().catch(() => ({}));
      return { status: response.status, json };
    } catch (e) {
      throw new ServiceUnavailableException(e instanceof Error && e.name === 'AbortError' ? 'M-Pesa took too long to answer' : 'Could not reach M-Pesa');
    } finally {
      clearTimeout(timer);
    }
  }

  private async getToken(creds: Pick<DarajaCredentials, 'environment' | 'consumerKey' | 'consumerSecret'>, fresh = false): Promise<string> {
    const cacheKey = `${creds.environment}:${creds.consumerKey}`;
    const cached = this.tokenCache.get(cacheKey);
    if (!fresh && cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const basic = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64');
      const response = await fetch(`${this.baseUrl(creds.environment)}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${basic}` },
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown };
      if (!response.ok || typeof json.access_token !== 'string') {
        throw new BadRequestException('Safaricom did not accept that consumer key and secret - check them and the Sandbox/Live setting');
      }
      const seconds = Number(json.expires_in) || 3000;
      this.tokenCache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + seconds * 1000 });
      return json.access_token;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new ServiceUnavailableException('Could not reach Safaricom to check the credentials - try again');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Rejects a mistyped key/secret at save time, instead of the first shopper finding out. */
  async verifyCredentials(creds: Pick<DarajaCredentials, 'environment' | 'consumerKey' | 'consumerSecret'>): Promise<void> {
    await this.getToken(creds, true);
  }

  /** Sends the M-Pesa prompt; the money lands in the business's own Paybill/Till. Returns the CheckoutRequestID. */
  async stkPush(
    creds: DarajaCredentials,
    input: { amount: number; phone: string; accountReference: string; description: string; callbackUrl: string },
  ): Promise<{ checkoutRequestId: string }> {
    const token = await this.getToken(creds);
    const timestamp = darajaTimestamp();
    const { status, json } = await this.post(`${this.baseUrl(creds.environment)}/mpesa/stkpush/v1/processrequest`, token, {
      ...stkAccountFields(creds),
      Password: darajaPassword(creds.shortcode, creds.passkey, timestamp),
      Timestamp: timestamp,
      Amount: Math.ceil(input.amount),
      PartyA: input.phone,
      PhoneNumber: input.phone,
      CallBackURL: input.callbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    });
    const body = json as { CheckoutRequestID?: unknown; ResponseCode?: unknown; errorMessage?: unknown; ResponseDescription?: unknown };
    if (status >= 400 || (body.ResponseCode !== undefined && String(body.ResponseCode) !== '0') || typeof body.CheckoutRequestID !== 'string') {
      this.logger.warn({ status, errorMessage: body.errorMessage, responseDescription: body.ResponseDescription }, 'Daraja STK push was not accepted');
      const reason = typeof body.errorMessage === 'string' ? body.errorMessage : typeof body.ResponseDescription === 'string' ? body.ResponseDescription : 'M-Pesa did not accept the request';
      throw new ServiceUnavailableException(`Could not start the M-Pesa payment: ${reason}`);
    }
    return { checkoutRequestId: body.CheckoutRequestID };
  }

  /** Safaricom's STK query: free, so it is safe to use whenever a callback was missing or incomplete. */
  async queryStk(creds: DarajaCredentials, checkoutRequestId: string): Promise<DarajaQueryOutcome> {
    try {
      const token = await this.getToken(creds);
      const timestamp = darajaTimestamp();
      const { json } = await this.post(`${this.baseUrl(creds.environment)}/mpesa/stkpushquery/v1/query`, token, {
        BusinessShortCode: creds.shortcode,
        Password: darajaPassword(creds.shortcode, creds.passkey, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      });
      return parseDarajaQuery(json);
    } catch (e) {
      return { outcome: 'unconfirmed', detail: e instanceof Error ? e.message : 'could not ask M-Pesa' };
    }
  }
}
