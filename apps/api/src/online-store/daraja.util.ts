/**
 * Pure helpers for a business collecting online payments through its OWN Safaricom Daraja app (Paybill or
 * Till). The trust model is the same as for Tuma (tuma.util.ts): the callback address carries a secret only the
 * shop's payment request was given, and a callback is only acted on when it is complete and consistent with the
 * order - otherwise it falls back to Safaricom's STK query, which is free (unlike Tuma's).
 */
import type { CallbackVerdict } from './tuma.util';

type Loose = Record<string, unknown> | null | undefined;
const asObject = (value: unknown): Loose => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null);

/** Daraja's timestamp: YYYYMMDDHHmmss, in Nairobi time. */
export function darajaTimestamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

export function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

export type MpesaAccountType = 'PAYBILL' | 'TILL';

/**
 * What to send as TransactionType / BusinessShortCode / PartyB. A Paybill uses its number for both; a Till
 * (Buy Goods) signs with the store number and receives on the till number.
 */
export function stkAccountFields(account: { accountType: string | null; shortcode: string; tillNumber: string | null }) {
  if (account.accountType === 'TILL') {
    return {
      TransactionType: 'CustomerBuyGoodsOnline',
      BusinessShortCode: account.shortcode,
      PartyB: account.tillNumber || account.shortcode,
    };
  }
  return { TransactionType: 'CustomerPayBillOnline', BusinessShortCode: account.shortcode, PartyB: account.shortcode };
}

export interface ParsedDarajaCallback {
  checkoutRequestId?: string;
  merchantRequestId?: string;
  resultCode?: number;
  resultDesc?: string;
  amount?: number;
  receipt?: string;
}

/** Body.stkCallback as Safaricom sends it; the paid details sit in CallbackMetadata.Item as {Name, Value} pairs. */
export function parseDarajaCallback(body: unknown): ParsedDarajaCallback {
  const root = asObject(body);
  const callback = asObject(asObject(root?.Body)?.stkCallback) ?? asObject(root?.stkCallback);
  if (!callback) return {};
  const items = asObject(callback.CallbackMetadata)?.Item;
  const meta: Record<string, unknown> = {};
  if (Array.isArray(items)) {
    for (const item of items) {
      const entry = asObject(item);
      if (entry && typeof entry.Name === 'string') meta[entry.Name] = entry.Value;
    }
  }
  const code = callback.ResultCode;
  const amount = meta.Amount !== undefined ? Number(meta.Amount) : undefined;
  return {
    checkoutRequestId: typeof callback.CheckoutRequestID === 'string' ? callback.CheckoutRequestID : undefined,
    merchantRequestId: typeof callback.MerchantRequestID === 'string' ? callback.MerchantRequestID : undefined,
    resultCode: code === undefined || code === null || code === '' ? undefined : Number(code),
    resultDesc: typeof callback.ResultDesc === 'string' ? callback.ResultDesc : undefined,
    amount: amount !== undefined && Number.isFinite(amount) ? amount : undefined,
    receipt: typeof meta.MpesaReceiptNumber === 'string' ? meta.MpesaReceiptNumber.trim() : undefined,
  };
}

/** Plain-words reasons for the result codes a shopper is most likely to hit. */
export function darajaFailureMessage(resultCode: number | undefined, resultDesc?: string): string {
  switch (resultCode) {
    case 1032:
      return 'The M-Pesa payment was cancelled - try again';
    case 1037:
      return 'The M-Pesa prompt did not reach your phone in time - check your phone is on and try again';
    case 1:
      return 'There was not enough money in your M-Pesa for this payment';
    case 2001:
      return 'The M-Pesa PIN was wrong - try again';
    case 1001:
      return 'Another M-Pesa payment is already in progress on your phone - wait a minute and try again';
    default:
      return resultDesc ? `The M-Pesa payment did not go through (${resultDesc}) - try again` : 'The M-Pesa payment did not go through - try again';
  }
}

/** Decides what a Daraja callback means for an order. Only a complete, matching success may settle anything. */
export function evaluateDarajaCallback(body: unknown, expected: { amount: number; latestRequestId?: string | null }): CallbackVerdict {
  const parsed = parseDarajaCallback(body);
  if (parsed.resultCode === undefined) return { kind: 'pending' };
  if (parsed.resultCode !== 0) return { kind: 'failed' };

  if (parsed.checkoutRequestId && expected.latestRequestId && parsed.checkoutRequestId !== expected.latestRequestId) {
    return { kind: 'needs-check', reason: 'the callback is for an earlier payment request' };
  }
  if (parsed.amount === undefined) return { kind: 'needs-check', reason: 'the callback gave no amount' };
  if (parsed.amount < expected.amount - 0.009) {
    return { kind: 'review', detail: `M-Pesa reported KES ${parsed.amount}, expected at least KES ${expected.amount}` };
  }
  if (!parsed.receipt) return { kind: 'needs-check', reason: 'the callback carried no M-Pesa receipt' };
  return { kind: 'paid', receipt: parsed.receipt };
}

export type DarajaQueryOutcome =
  | { outcome: 'paid' }
  | { outcome: 'failed'; resultCode: number; resultDesc?: string }
  // Safaricom says it is still working on it, or gave no answer we can read.
  | { outcome: 'unconfirmed'; detail: string };

/** The STK query response: ResultCode "0" is paid; another number is a definite failure; anything else is "not yet". */
export function parseDarajaQuery(body: unknown): DarajaQueryOutcome {
  const root = asObject(body);
  const code = root?.ResultCode;
  if (code === undefined || code === null || code === '') {
    const detail = typeof root?.errorMessage === 'string' ? root.errorMessage : 'no result yet';
    return { outcome: 'unconfirmed', detail };
  }
  const n = Number(code);
  if (!Number.isFinite(n)) return { outcome: 'unconfirmed', detail: 'unreadable result' };
  if (n === 0) return { outcome: 'paid' };
  return { outcome: 'failed', resultCode: n, resultDesc: typeof root?.ResultDesc === 'string' ? root.ResultDesc : undefined };
}
