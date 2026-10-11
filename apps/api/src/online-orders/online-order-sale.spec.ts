import { tenantContext } from '../common/tenant/tenant-context';
import { onlineSaleClientId, recordOnlineSale, voidOnlineSale, ONLINE_TERMINAL_LABEL } from './online-order-sale';

const order = (over: Record<string, unknown> = {}) =>
  ({
    id: 'order-1',
    branchId: 'branch-1',
    subtotal: 500,
    mpesaReceiptNumber: 'UJBPD9NF5O',
    lines: [{ variantId: 'v1', quantity: 2, unitPrice: 250 }],
    ...over,
  }) as never;

function makeTx(opts: { sale?: { id: string } | null; terminal?: { id: string } | null; session?: { id: string } | null } = {}) {
  return {
    sale: {
      findUnique: jest.fn().mockResolvedValue(opts.sale ?? null),
      create: jest.fn().mockResolvedValue({ id: 'sale-new' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    terminal: {
      findFirst: jest.fn().mockResolvedValue(opts.terminal ?? null),
      create: jest.fn().mockResolvedValue({ id: 'term-new' }),
    },
    cashierSession: {
      findFirst: jest.fn().mockResolvedValue(opts.session ?? null),
      create: jest.fn().mockResolvedValue({ id: 'sess-new' }),
    },
  };
}

const inTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: 'org-1', orgUserId: 'staff-1' } as never, fn);

describe('recordOnlineSale', () => {
  it('writes a completed M-Pesa sale for what the shopper paid, with the receipt, under the "Online shop" device', async () => {
    const tx = makeTx();
    const id = await inTenant(() => recordOnlineSale(tx as never, order()));

    expect(id).toBe('sale-new');
    expect(tx.terminal.create).toHaveBeenCalledWith({ data: { branchId: 'branch-1', deviceLabel: ONLINE_TERMINAL_LABEL } });
    expect(tx.cashierSession.create).toHaveBeenCalledWith({ data: { terminalId: 'term-new', orgUserId: 'staff-1' } });
    const data = tx.sale.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: 'org-1',
      branchId: 'branch-1',
      terminalId: 'term-new',
      cashierSessionId: 'sess-new',
      cashierOrgUserId: 'staff-1',
      clientId: onlineSaleClientId('order-1'),
      status: 'COMPLETED',
      total: 500,
    });
    expect(data.lineItems.create).toEqual([{ variantId: 'v1', quantity: 2, unitPrice: 250, taxAmount: 0 }]);
    expect(data.payments.create).toMatchObject({ method: 'MPESA', amount: 500, providerReference: 'UJBPD9NF5O', settlementCurrency: 'KES' });
  });

  it('reuses the existing online device and the accepting staff member\'s open session', async () => {
    const tx = makeTx({ terminal: { id: 'term-old' }, session: { id: 'sess-old' } });
    await inTenant(() => recordOnlineSale(tx as never, order()));
    expect(tx.terminal.create).not.toHaveBeenCalled();
    expect(tx.cashierSession.create).not.toHaveBeenCalled();
    expect(tx.sale.create.mock.calls[0][0].data).toMatchObject({ terminalId: 'term-old', cashierSessionId: 'sess-old' });
  });

  it('never makes a second sale for the same order', async () => {
    const tx = makeTx({ sale: { id: 'sale-existing' } });
    const id = await inTenant(() => recordOnlineSale(tx as never, order()));
    expect(id).toBe('sale-existing');
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(tx.terminal.create).not.toHaveBeenCalled();
  });
});

describe('voidOnlineSale', () => {
  it('voids only a completed sale', async () => {
    const tx = makeTx();
    await voidOnlineSale(tx as never, 'sale-1');
    expect(tx.sale.updateMany).toHaveBeenCalledWith({ where: { id: 'sale-1', status: 'COMPLETED' }, data: { status: 'VOIDED' } });
  });

  it('does nothing for an order that never had a sale', async () => {
    const tx = makeTx();
    await voidOnlineSale(tx as never, null);
    expect(tx.sale.updateMany).not.toHaveBeenCalled();
  });
});
