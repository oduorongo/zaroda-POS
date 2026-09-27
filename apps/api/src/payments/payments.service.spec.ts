import { StkRequestStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';

function setup(opts: {
  row: { status: StkRequestStatus } | null;
  query: { state: 'PENDING' | 'SUCCESS' | 'FAILED'; resultDesc?: string } | Error;
}) {
  const findUnique = jest.fn().mockResolvedValue(opts.row);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    mpesaStkRequest: { findUnique, updateMany },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const queryStkStatus =
    opts.query instanceof Error
      ? jest.fn().mockRejectedValue(opts.query)
      : jest.fn().mockResolvedValue(opts.query);
  const service = new PaymentsService(
    prisma as never,
    {} as never,
    { queryStkStatus } as never,
  );
  return { service, updateMany, queryStkStatus };
}

const callback = (resultCode: number) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: 'm-1',
      CheckoutRequestID: 'ws_CO_1',
      ResultCode: resultCode,
      ResultDesc: 'from callback',
      CallbackMetadata: {
        Item: [{ Name: 'MpesaReceiptNumber', Value: 'SIJ123ABC' }],
      },
    },
  },
});

describe('PaymentsService.handleMpesaCallback', () => {
  it('does not trust a forged success callback that Daraja says is still pending', async () => {
    const { service, updateMany } = setup({
      row: { status: StkRequestStatus.PENDING },
      query: { state: 'PENDING' },
    });

    await service.handleMpesaCallback('org-1', callback(0));

    const data = updateMany.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
  });

  it('does not trust a forged failure callback for a payment Daraja confirms', async () => {
    const { service, updateMany } = setup({
      row: { status: StkRequestStatus.PENDING },
      query: { state: 'SUCCESS', resultDesc: 'ok' },
    });

    await service.handleMpesaCallback('org-1', callback(1032));

    expect(updateMany).toHaveBeenCalledWith({
      where: { checkoutRequestId: 'ws_CO_1', status: StkRequestStatus.PENDING },
      data: {
        status: StkRequestStatus.SUCCESS,
        mpesaReceiptNumber: 'SIJ123ABC',
        resultDesc: 'ok',
      },
    });
  });

  it('marks FAILED only when Daraja says so', async () => {
    const { service, updateMany } = setup({
      row: { status: StkRequestStatus.PENDING },
      query: { state: 'FAILED', resultDesc: 'Request cancelled by user' },
    });

    await service.handleMpesaCallback('org-1', callback(1032));

    expect(updateMany.mock.calls[0][0].data).toEqual({
      status: StkRequestStatus.FAILED,
      resultDesc: 'Request cancelled by user',
    });
  });

  it('leaves the request pending if Daraja cannot be reached', async () => {
    const { service, updateMany } = setup({
      row: { status: StkRequestStatus.PENDING },
      query: new Error('network down'),
    });

    await service.handleMpesaCallback('org-1', callback(0));

    expect(updateMany.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('ignores callbacks for requests that are already settled', async () => {
    const { service, updateMany, queryStkStatus } = setup({
      row: { status: StkRequestStatus.SUCCESS },
      query: { state: 'FAILED' },
    });

    await service.handleMpesaCallback('org-1', callback(1));

    expect(queryStkStatus).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
