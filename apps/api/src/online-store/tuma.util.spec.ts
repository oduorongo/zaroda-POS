import {
  amountMismatch,
  isSuccessStatus,
  judgePayment,
  parseCallback,
  parseStatusResponse,
  parseStkResponse,
} from './tuma.util';

describe('isSuccessStatus', () => {
  it.each(['success', 'Successful', ' COMPLETED '])('accepts %p', (s) => expect(isSuccessStatus(s)).toBe(true));
  // The reason matching is exact, not a pattern: these all contain a success word.
  it.each(['unsuccessful', 'not completed', 'pending', 'failed', '', undefined, null])('rejects %p', (s) =>
    expect(isSuccessStatus(s)).toBe(false),
  );
});

describe('amountMismatch', () => {
  it('tolerates rounding but not a different sum', () => {
    expect(amountMismatch(500, 500)).toBe(false);
    expect(amountMismatch(500, '500.00')).toBe(false);
    expect(amountMismatch(500, 499.999)).toBe(false);
    expect(amountMismatch(500, 100)).toBe(true);
    expect(amountMismatch(500, 'abc')).toBe(true);
  });
  it('does not flag a missing reported amount (the status alone is checked separately)', () => {
    expect(amountMismatch(500, undefined)).toBe(false);
    expect(amountMismatch(500, '')).toBe(false);
  });
});

describe('parseStkResponse', () => {
  it('reads the merchant request id from data or the top level', () => {
    expect(parseStkResponse({ success: true, data: { payment_id: 'p', merchant_request_id: 'm-1' } }).merchantRequestId).toBe('m-1');
    expect(parseStkResponse({ MerchantRequestID: 'm-2' }).merchantRequestId).toBe('m-2');
    expect(parseStkResponse({ data: {} }).merchantRequestId).toBeUndefined();
    expect(parseStkResponse(null).merchantRequestId).toBeUndefined();
  });
});

describe('parseStatusResponse', () => {
  it('reads status, receipt and amount from the likely shapes', () => {
    expect(parseStatusResponse({ status: 'completed', mpesa_receipt_number: 'QAB1', amount: 500 })).toEqual({
      status: 'completed',
      mpesaReceipt: 'QAB1',
      amount: 500,
    });
    expect(parseStatusResponse({ data: { status: 'success', mpesa_receipt: 'QAB2', amount: '250' } })).toEqual({
      status: 'success',
      mpesaReceipt: 'QAB2',
      amount: 250,
    });
  });
});

describe('parseCallback', () => {
  it('treats result code 0 or a success status as a hint to check', () => {
    expect(parseCallback({ merchant_request_id: 'm', status: 'completed' })).toEqual({ merchantRequestId: 'm', success: true });
    expect(parseCallback({ MerchantRequestID: 'm', ResultCode: 0 }).success).toBe(true);
    expect(parseCallback({ merchant_request_id: 'm', status: 'failed' }).success).toBe(false);
    expect(parseCallback({}).merchantRequestId).toBeUndefined();
  });
});

describe('judgePayment', () => {
  it('only a success for the right amount is paid', () => {
    expect(judgePayment({ status: 'completed', amount: 500, mpesaReceipt: 'Q1' }, 500)).toEqual({ outcome: 'paid', mpesaReceipt: 'Q1' });
  });
  it('flags a success for a different amount for review, never as paid', () => {
    expect(judgePayment({ status: 'completed', amount: 100 }, 500).outcome).toBe('review');
  });
  it('is unconfirmed for anything not a clear success', () => {
    expect(judgePayment({ status: 'pending' }, 500).outcome).toBe('unconfirmed');
    expect(judgePayment({}, 500).outcome).toBe('unconfirmed');
  });
});
