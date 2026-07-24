import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentInitiationResult,
  PaymentProcessor,
} from './payment-processor.interface';
import { withSpan } from '../common/observability/trace-span.util';

/**
 * Safaricom Daraja STK Push (Lipa Na M-Pesa Online). Implemented against the
 * published API spec but NOT YET LIVE-TESTED - this environment has no
 * sandbox credentials. The full plumbing is wired (PaymentsController's
 * initiate/callback/status endpoints, MpesaStkRequest tracking the async
 * settlement, SalesService accepting a MPESA payment once a request reaches
 * SUCCESS), so the only missing piece is real Daraja credentials in env -
 * every `requireConfig` call below throws a clear "not configured" error
 * until then, rather than silently misbehaving.
 *
 * Required env: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
 * MPESA_PASSKEY, MPESA_CALLBACK_URL (base path - PaymentsController appends
 * `/:organizationId`, see initiateTraced below). MPESA_ENV=production
 * switches off the sandbox host; defaults to sandbox.
 */
@Injectable()
export class MpesaPaymentProcessor implements PaymentProcessor {
  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('MPESA_ENV') === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
  }

  private requireConfig(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(
        `M-Pesa is not configured (${key} missing) - STK push cannot be initiated until Daraja credentials are set.`,
      );
    }
    return value;
  }

  private async getAccessToken(): Promise<string> {
    const consumerKey = this.requireConfig('MPESA_CONSUMER_KEY');
    const consumerSecret = this.requireConfig('MPESA_CONSUMER_SECRET');
    const credentials = Buffer.from(
      `${consumerKey}:${consumerSecret}`,
    ).toString('base64');

    const response = await fetch(
      `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${credentials}` },
      },
    );
    if (!response.ok) {
      throw new InternalServerErrorException(
        `M-Pesa OAuth failed: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { access_token: string };
    return body.access_token;
  }

  /** YYYYMMDDHHmmss, as Daraja requires for both the password hash and the request timestamp. */
  private timestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  async initiate(input: {
    amountKes: number;
    reference: string;
    phoneNumber?: string;
    organizationId: string;
  }): Promise<PaymentInitiationResult> {
    return withSpan(
      'mpesa.stk_push',
      { reference: input.reference, amountKes: input.amountKes },
      () => this.initiateTraced(input),
    );
  }

  // Two awaited network round trips (OAuth, then the STK push itself) is
  // exactly the shape a multi-step bug likes to hide in - a trace here
  // shows which of the two actually took the time or failed, not just
  // "M-Pesa was slow/broken" from the outside.
  private async initiateTraced(input: {
    amountKes: number;
    reference: string;
    phoneNumber?: string;
    organizationId: string;
  }): Promise<PaymentInitiationResult> {
    if (!input.phoneNumber) {
      throw new InternalServerErrorException(
        'phoneNumber is required to initiate an M-Pesa STK push',
      );
    }

    const shortcode = this.requireConfig('MPESA_SHORTCODE');
    const passkey = this.requireConfig('MPESA_PASSKEY');
    // MPESA_CALLBACK_URL is the base webhook path (e.g.
    // https://api.example.com/payments/mpesa/callback); the organizationId
    // is appended so PaymentsController.mpesaCallback can establish tenant
    // context (set_config('app.current_tenant', ...)) before touching the
    // database, without the callback carrying any auth token of its own -
    // Safaricom's webhook has none to give it. See PublicBookingService for
    // the same URL-carries-tenant-identity pattern used elsewhere.
    const callbackUrl = `${this.requireConfig('MPESA_CALLBACK_URL').replace(/\/+$/, '')}/${input.organizationId}`;
    const accessToken = await withSpan('mpesa.oauth', {}, () =>
      this.getAccessToken(),
    );
    const timestamp = this.timestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString(
      'base64',
    );

    const response = await fetch(
      `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: Math.round(input.amountKes),
          PartyA: input.phoneNumber,
          PartyB: shortcode,
          PhoneNumber: input.phoneNumber,
          CallBackURL: callbackUrl,
          AccountReference: input.reference,
          TransactionDesc: `ZARODA POS sale ${input.reference}`,
        }),
      },
    );
    if (!response.ok) {
      throw new InternalServerErrorException(
        `M-Pesa STK push failed: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { CheckoutRequestID: string };

    // Not settled yet - the customer still has to approve the prompt on
    // their phone. The callback webhook (not yet built - see class comment)
    // is what will eventually mark this payment/sale complete.
    return {
      settledImmediately: false,
      providerReference: body.CheckoutRequestID,
    };
  }
}
