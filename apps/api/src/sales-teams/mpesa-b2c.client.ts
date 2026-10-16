import { constants, publicEncrypt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** What Safaricom's B2C result callback says about one payment (Result.ResultParameters is a list of {Key, Value}). */
export interface ParsedB2cResult {
  originatorConversationId?: string;
  resultCode?: number;
  resultDesc?: string;
  receipt?: string;
  amount?: number;
}

type Loose = Record<string, unknown> | null | undefined;
const asObject = (value: unknown): Loose => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null);

export function parseB2cResult(body: unknown): ParsedB2cResult {
  const result = asObject(asObject(body)?.Result);
  if (!result) return {};
  const params = asObject(result.ResultParameters);
  const items = Array.isArray(params?.ResultParameter) ? (params?.ResultParameter as Loose[]) : [];
  const get = (key: string) => items.find((i) => i?.Key === key)?.Value;
  const amount = get('TransactionAmount');
  return {
    originatorConversationId: typeof result.OriginatorConversationID === 'string' ? result.OriginatorConversationID : undefined,
    resultCode: result.ResultCode === undefined ? undefined : Number(result.ResultCode),
    resultDesc: typeof result.ResultDesc === 'string' ? result.ResultDesc : undefined,
    receipt: typeof result.TransactionID === 'string' ? result.TransactionID : get('TransactionReceipt') === undefined ? undefined : String(get('TransactionReceipt')),
    amount: amount === undefined ? undefined : Number(amount),
  };
}

/**
 * Pays money out of Zaroda's M-Pesa business account to a person's phone (Daraja "B2C", BusinessPayment). Needs a
 * B2C-enabled shortcode and an API initiator from Safaricom, so it is only "set up" when every MPESA_B2C_* value is
 * present. The request is only an acknowledgement: the real outcome arrives later at the result URL, which carries
 * MPESA_B2C_CALLBACK_SECRET so only Safaricom (who was given the URL) can settle a payout.
 */
@Injectable()
export class MpesaB2cClient {
  private readonly logger = new Logger(MpesaB2cClient.name);
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {}

  private get(name: string): string | undefined {
    return this.config.get<string>(name) || undefined;
  }

  private get baseUrl(): string {
    return this.get('MPESA_B2C_ENV') === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  }

  isConfigured(): boolean {
    return Boolean(
      this.get('MPESA_B2C_CONSUMER_KEY') &&
        this.get('MPESA_B2C_CONSUMER_SECRET') &&
        this.get('MPESA_B2C_SHORTCODE') &&
        this.get('MPESA_B2C_INITIATOR') &&
        (this.get('MPESA_B2C_SECURITY_CREDENTIAL') || (this.get('MPESA_B2C_INITIATOR_PASSWORD') && this.get('MPESA_B2C_CERT_PATH'))) &&
        this.get('MPESA_B2C_CALLBACK_SECRET') &&
        this.get('PUBLIC_API_BASE_URL'),
    );
  }

  /** The callback secret, for the controller to check an incoming result against. */
  callbackSecret(): string | undefined {
    return this.get('MPESA_B2C_CALLBACK_SECRET');
  }

  private securityCredential(): string {
    const ready = this.get('MPESA_B2C_SECURITY_CREDENTIAL');
    if (ready) return ready;
    // The initiator password encrypted with Safaricom's public certificate, as Daraja requires.
    const cert = readFileSync(this.get('MPESA_B2C_CERT_PATH') as string, 'utf8');
    return publicEncrypt({ key: cert, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(this.get('MPESA_B2C_INITIATOR_PASSWORD') as string)).toString('base64');
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const auth = Buffer.from(`${this.get('MPESA_B2C_CONSUMER_KEY')}:${this.get('MPESA_B2C_CONSUMER_SECRET')}`).toString('base64');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ServiceUnavailableException('Could not reach M-Pesa');
    }
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: string };
    if (!response.ok || !body.access_token) throw new BadRequestException('M-Pesa rejected the B2C credentials');
    this.token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3500) * 1000 };
    return body.access_token;
  }

  /** Asks Safaricom to send `amount` (whole shillings) to `phone` (2547XXXXXXXX). Resolves once Safaricom accepted the request. */
  async send(input: { requestId: string; phone: string; amount: number; remarks: string }): Promise<{ conversationId?: string }> {
    if (!this.isConfigured()) throw new ServiceUnavailableException('M-Pesa B2C payouts are not set up on this server');
    const resultBase = `${(this.get('PUBLIC_API_BASE_URL') as string).replace(/\/+$/, '')}/sales-payouts/mpesa-b2c`;
    const secret = encodeURIComponent(this.callbackSecret() as string);
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/mpesa/b2c/v3/paymentrequest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          OriginatorConversationID: input.requestId,
          InitiatorName: this.get('MPESA_B2C_INITIATOR'),
          SecurityCredential: this.securityCredential(),
          CommandID: 'BusinessPayment',
          Amount: input.amount,
          PartyA: this.get('MPESA_B2C_SHORTCODE'),
          PartyB: input.phone,
          Remarks: input.remarks.slice(0, 100),
          QueueTimeOutURL: `${resultBase}/timeout/${secret}`,
          ResultURL: `${resultBase}/result/${secret}`,
          Occasion: 'Commission payout',
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ServiceUnavailableException('Could not reach M-Pesa to send the payout');
    }
    const body = (await response.json().catch(() => ({}))) as { ResponseCode?: string; ResponseDescription?: string; ConversationID?: string; errorMessage?: string };
    if (!response.ok || String(body.ResponseCode) !== '0') {
      this.logger.warn({ status: response.status, body }, 'M-Pesa B2C request refused');
      throw new BadRequestException(body.errorMessage ?? body.ResponseDescription ?? `M-Pesa refused the payout (${response.status})`);
    }
    return { conversationId: body.ConversationID };
  }
}
