import { evaluateCallback } from './tuma.util';

const expected = { amount: 500, latestRequestId: 'mr-2' };
const good = { merchant_request_id: 'mr-2', status: 'completed', amount: 500, mpesa_receipt_number: 'QAB1' };

describe('evaluateCallback (free webhook is primary; the paid status check is only a backup)', () => {
  it('accepts a complete success: right request, enough money, an M-Pesa receipt', () => {
    expect(evaluateCallback(good, expected)).toEqual({ kind: 'paid', receipt: 'QAB1' });
  });

  it('accepts the other field spellings Tuma might use (data wrapper, Daraja style)', () => {
    expect(evaluateCallback({ data: { merchant_request_id: 'mr-2', status: 'success', amount: '500', mpesa_receipt: 'QAB2' } }, expected)).toEqual({ kind: 'paid', receipt: 'QAB2' });
    expect(evaluateCallback({ MerchantRequestID: 'mr-2', ResultCode: 0, Amount: 500, MpesaReceiptNumber: 'QAB3' }, expected)).toEqual({ kind: 'paid', receipt: 'QAB3' });
  });

  it('accepts an overpayment but flags an underpayment for review', () => {
    expect(evaluateCallback({ ...good, amount: 600 }, expected).kind).toBe('paid');
    expect(evaluateCallback({ ...good, amount: 100 }, expected).kind).toBe('review');
    expect(evaluateCallback({ ...good, amount: 'abc' }, expected).kind).toBe('review');
  });

  it('does NOT trust a success that is missing the receipt or the amount - it needs a check', () => {
    const { mpesa_receipt_number: _r, ...noReceipt } = good;
    expect(evaluateCallback(noReceipt, expected).kind).toBe('needs-check');
    const { amount: _a, ...noAmount } = good;
    expect(evaluateCallback(noAmount, expected).kind).toBe('needs-check');
    expect(evaluateCallback({ ...good, mpesa_receipt_number: '   ' }, expected).kind).toBe('needs-check');
  });

  it('does NOT trust a callback for an earlier payment request', () => {
    expect(evaluateCallback({ ...good, merchant_request_id: 'mr-1' }, expected).kind).toBe('needs-check');
  });

  it('takes a callback that names no request id as being for this order (the address is per order)', () => {
    const { merchant_request_id: _m, ...noId } = good;
    expect(evaluateCallback(noId, expected).kind).toBe('paid');
  });

  it('recognises failures and cancellations so the buyer can retry', () => {
    expect(evaluateCallback({ merchant_request_id: 'mr-2', status: 'failed' }, expected).kind).toBe('failed');
    expect(evaluateCallback({ status: 'Cancelled' }, expected).kind).toBe('failed');
    expect(evaluateCallback({ ResultCode: 1032 }, expected).kind).toBe('failed');
  });

  it('does nothing for a still-pending or unrecognised callback', () => {
    expect(evaluateCallback({ status: 'pending' }, expected).kind).toBe('pending');
    expect(evaluateCallback({}, expected).kind).toBe('pending');
    expect(evaluateCallback(null, expected).kind).toBe('pending');
  });

  it("never treats words that merely contain 'success' or 'complete' as success", () => {
    for (const status of ['unsuccessful', 'not completed', 'incomplete']) {
      expect(evaluateCallback({ ...good, status }, expected).kind).not.toBe('paid');
    }
  });
});
