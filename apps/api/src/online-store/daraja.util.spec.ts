import {
  darajaFailureMessage,
  darajaPassword,
  darajaTimestamp,
  evaluateDarajaCallback,
  parseDarajaCallback,
  parseDarajaQuery,
  stkAccountFields,
} from './daraja.util';

const callback = (stk: Record<string, unknown>) => ({ Body: { stkCallback: stk } });
const paid = (extra: Record<string, unknown> = {}, items: Array<{ Name: string; Value: unknown }> = []) =>
  callback({
    MerchantRequestID: 'm-1',
    CheckoutRequestID: 'ws_CO_1',
    ResultCode: 0,
    ResultDesc: 'ok',
    CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }, { Name: 'MpesaReceiptNumber', Value: 'ABC123' }, ...items] },
    ...extra,
  });

describe('darajaTimestamp / darajaPassword', () => {
  it('formats Nairobi time as YYYYMMDDHHmmss', () => {
    // 21:30:05 UTC is 00:30:05 the next day in Nairobi (UTC+3).
    expect(darajaTimestamp(new Date('2026-10-13T21:30:05Z'))).toBe('20261014003005');
  });

  it('builds the base64 password from shortcode + passkey + timestamp', () => {
    expect(darajaPassword('174379', 'pk', '20261014003005')).toBe(Buffer.from('174379pk20261014003005').toString('base64'));
  });
});

describe('stkAccountFields', () => {
  it('a Paybill signs and receives on the same number', () => {
    expect(stkAccountFields({ accountType: 'PAYBILL', shortcode: '174379', tillNumber: null })).toEqual({
      TransactionType: 'CustomerPayBillOnline',
      BusinessShortCode: '174379',
      PartyB: '174379',
    });
  });

  it('a Till signs with the store number and receives on the till number', () => {
    expect(stkAccountFields({ accountType: 'TILL', shortcode: '654321', tillNumber: '555111' })).toEqual({
      TransactionType: 'CustomerBuyGoodsOnline',
      BusinessShortCode: '654321',
      PartyB: '555111',
    });
  });
});

describe('parseDarajaCallback', () => {
  it('reads the request ids, result, amount and receipt', () => {
    expect(parseDarajaCallback(paid())).toMatchObject({
      checkoutRequestId: 'ws_CO_1',
      merchantRequestId: 'm-1',
      resultCode: 0,
      amount: 500,
      receipt: 'ABC123',
    });
  });

  it('copes with junk', () => {
    expect(parseDarajaCallback(null)).toEqual({});
    expect(parseDarajaCallback({ hello: 'world' })).toEqual({});
  });
});

describe('evaluateDarajaCallback', () => {
  const expected = { amount: 500, latestRequestId: 'ws_CO_1' };

  it('accepts a complete matching success', () => {
    expect(evaluateDarajaCallback(paid(), expected)).toEqual({ kind: 'paid', receipt: 'ABC123' });
  });

  it('accepts an overpayment', () => {
    expect(evaluateDarajaCallback(paid({}, []), { amount: 400, latestRequestId: 'ws_CO_1' })).toEqual({ kind: 'paid', receipt: 'ABC123' });
  });

  it('flags a short payment for review instead of settling', () => {
    expect(evaluateDarajaCallback(paid(), { amount: 800, latestRequestId: 'ws_CO_1' })).toMatchObject({ kind: 'review' });
  });

  it('treats any non-zero result code as failed', () => {
    expect(evaluateDarajaCallback(callback({ CheckoutRequestID: 'ws_CO_1', ResultCode: 1032, ResultDesc: 'cancelled' }), expected)).toEqual({ kind: 'failed' });
  });

  it('does not trust a success for an earlier payment request', () => {
    expect(evaluateDarajaCallback(paid({ CheckoutRequestID: 'ws_CO_OLD' }), expected)).toMatchObject({ kind: 'needs-check' });
  });

  it('does not trust a success with no receipt', () => {
    const noReceipt = callback({ CheckoutRequestID: 'ws_CO_1', ResultCode: 0, CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }] } });
    expect(evaluateDarajaCallback(noReceipt, expected)).toMatchObject({ kind: 'needs-check' });
  });

  it('does not trust a success with no amount', () => {
    const noAmount = callback({ CheckoutRequestID: 'ws_CO_1', ResultCode: 0, CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: 'X1' }] } });
    expect(evaluateDarajaCallback(noAmount, expected)).toMatchObject({ kind: 'needs-check' });
  });

  it('is pending when there is no result at all', () => {
    expect(evaluateDarajaCallback({}, expected)).toEqual({ kind: 'pending' });
  });
});

describe('parseDarajaQuery', () => {
  it('ResultCode 0 is paid', () => {
    expect(parseDarajaQuery({ ResponseCode: '0', ResultCode: '0' })).toEqual({ outcome: 'paid' });
  });

  it('another number is a definite failure with its code', () => {
    expect(parseDarajaQuery({ ResultCode: '1032', ResultDesc: 'Request cancelled by user' })).toEqual({
      outcome: 'failed',
      resultCode: 1032,
      resultDesc: 'Request cancelled by user',
    });
  });

  it('"still processing" (an error body with no ResultCode) is unconfirmed, not failed', () => {
    expect(parseDarajaQuery({ errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' })).toEqual({
      outcome: 'unconfirmed',
      detail: 'The transaction is being processed',
    });
  });
});

describe('darajaFailureMessage', () => {
  it.each([
    [1032, /cancelled/i],
    [1037, /did not reach/i],
    [1, /not enough money/i],
    [2001, /PIN was wrong/i],
    [1001, /already in progress/i],
  ])('explains %p in plain words', (code, pattern) => {
    expect(darajaFailureMessage(code)).toMatch(pattern);
  });

  it('falls back to a generic message that keeps the reason', () => {
    expect(darajaFailureMessage(9999, 'Something odd')).toContain('Something odd');
  });
});
