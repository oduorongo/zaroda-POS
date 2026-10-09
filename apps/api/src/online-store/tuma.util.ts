/**
 * Pure helpers for reading Tuma (tuma.co.ke) responses. Ported from the
 * school system's own Tuma client (zaroda school backend, common/tuma.ts),
 * which has been through Tuma's go-live review - Tuma publishes no response
 * schemas, so parsing is deliberately permissive about field names and the
 * rule everywhere is: a callback never settles a payment, it only prompts
 * a status check with Tuma, and Tuma's own answer decides.
 */

// Exact, case-insensitive matches only: a pattern test such as
// /success|completed/ would also accept "unsuccessful" or "not completed".
const SUCCESS_STATUSES = ['success', 'successful', 'completed'];

export function isSuccessStatus(status: unknown): boolean {
  return SUCCESS_STATUSES.includes(String(status ?? '').trim().toLowerCase());
}

/** Differ by more than rounding: Tuma reported a different sum than we asked for. */
export function amountMismatch(expected: number, reported: unknown): boolean {
  if (reported === undefined || reported === null || reported === '') return false;
  const r = Number(reported);
  return !Number.isFinite(r) || Math.abs(r - Number(expected)) > 0.009;
}

type Loose = Record<string, unknown> | null | undefined;
const pick = (body: Loose, ...keys: string[]): unknown => {
  for (const key of keys) {
    const value = body?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};
const asObject = (value: unknown): Loose => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null);

export interface ParsedStkResponse {
  merchantRequestId?: string;
}

/** The STK push response carries Tuma's merchant request id, at the top level or under `data`. */
export function parseStkResponse(body: unknown): ParsedStkResponse {
  const root = asObject(body);
  const data = asObject(root?.data);
  const id = pick(root, 'merchant_request_id', 'MerchantRequestID') ?? pick(data, 'merchant_request_id', 'MerchantRequestID');
  return { merchantRequestId: typeof id === 'string' ? id : undefined };
}

export interface ParsedStatus {
  status?: string;
  mpesaReceipt?: string;
  amount?: number;
}

/** Tuma's /payment/status response. */
export function parseStatusResponse(body: unknown): ParsedStatus {
  const root = asObject(body);
  const data = asObject(root?.data);
  const status = pick(root, 'status', 'Status', 'result_desc', 'ResultDesc') ?? pick(data, 'status');
  const receipt =
    pick(root, 'mpesa_receipt', 'mpesa_receipt_number', 'MpesaReceiptNumber', 'receipt_number') ??
    pick(data, 'mpesa_receipt', 'mpesa_receipt_number');
  const rawAmount = pick(root, 'amount', 'Amount') ?? pick(data, 'amount', 'Amount');
  return {
    status: status === undefined ? undefined : String(status),
    mpesaReceipt: receipt === undefined ? undefined : String(receipt),
    amount: rawAmount === undefined ? undefined : Number(rawAmount),
  };
}

export interface ParsedCallback {
  merchantRequestId?: string;
  success: boolean;
}

/**
 * Best-effort read of a Tuma callback. `success` is only a hint to go and
 * check - never proof (see the file comment).
 */
export function parseCallback(body: unknown): ParsedCallback {
  const root = asObject(body);
  const data = asObject(root?.data);
  const id = pick(root, 'merchant_request_id', 'MerchantRequestID') ?? pick(data, 'merchant_request_id', 'MerchantRequestID');
  const resultCode = pick(root, 'result_code', 'ResultCode') ?? pick(data, 'result_code', 'ResultCode');
  const status = pick(root, 'status', 'Status') ?? pick(data, 'status');
  return {
    merchantRequestId: typeof id === 'string' ? id : undefined,
    success: resultCode === 0 || resultCode === '0' || isSuccessStatus(status),
  };
}

export type PaymentConfirmation =
  | { outcome: 'paid'; mpesaReceipt?: string }
  // Tuma reports a success for a DIFFERENT amount: a person has to look at it.
  | { outcome: 'review'; mpesaReceipt?: string; detail: string }
  | { outcome: 'unconfirmed'; detail: string };

/** Only 'paid' may settle anything. */
export function judgePayment(status: ParsedStatus, expectedAmount: number): PaymentConfirmation {
  if (!isSuccessStatus(status.status)) {
    return { outcome: 'unconfirmed', detail: `Tuma status: ${status.status ?? 'unknown'}` };
  }
  if (amountMismatch(expectedAmount, status.amount)) {
    return {
      outcome: 'review',
      mpesaReceipt: status.mpesaReceipt,
      detail: `Tuma reported KES ${status.amount}, expected KES ${expectedAmount}`,
    };
  }
  return { outcome: 'paid', mpesaReceipt: status.mpesaReceipt };
}

/** Decode a JWT's exp claim (ms since epoch) without verifying it - we only need it to know when to refresh. */
export function jwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
