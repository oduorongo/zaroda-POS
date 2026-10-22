import { BadRequestException, ConflictException } from '@nestjs/common';
import { RestaurantTab } from '@prisma/client';
import { RestaurantTabPaymentsService } from './restaurant-tab-payments.service';

const TAB_ID = '11111111-1111-4111-8111-111111111111';
const LINE_A = '22222222-2222-4222-8222-222222222221';
const LINE_B = '22222222-2222-4222-8222-222222222222';
const till = { terminalId: 't', cashierSessionId: 's' };

const line = (id: string, status = 'ORDERED') => ({
  id,
  status,
  variantId: `v-${id}`,
  quantity: 1,
});
const fullTab = (status: string, lines: ReturnType<typeof line>[]) => ({
  id: TAB_ID,
  status,
  branchId: 'branch',
  tableId: 'table',
  table: { id: 'table', label: 'T1', branchId: 'branch' },
  openedAt: new Date(),
  closedAt: null,
  guestCount: 1,
  notes: null,
  voidReason: null,
  tabSales: [],
  lines: lines.map((l) => ({
    ...l,
    variant: {
      price: 100,
      name: 'x',
      product: { name: 'Plate', taxClass: null },
    },
    station: { name: 'Grill' },
    unitPrice: 100,
    stationId: 's',
    courseNumber: 1,
    notes: null,
    voidReason: null,
    kitchenTicketId: null,
  })),
});

function setup(
  opts: {
    tab?: ReturnType<typeof fullTab>;
    claimCount?: number;
    existingSale?: { id: string } | null;
    linked?: { tabId: string } | null;
    remaining?: number;
    saleError?: Error;
  } = {},
) {
  const tab = opts.tab ?? fullTab('OPEN', [line(LINE_A), line(LINE_B)]);
  const tx = {
    sale: {
      findUnique: jest.fn().mockResolvedValue(opts.existingSale ?? null),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({
          id: 'sale-1',
          total: 200,
          payments: [{ method: 'CASH' }],
        }),
    },
    restaurantTabSale: {
      findUnique: jest.fn().mockResolvedValue(opts.linked ?? null),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
    restaurantSaleTable: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    restaurantSaleTip: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    restaurantTabLine: {
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 2 }),
      count: jest.fn().mockResolvedValue(opts.remaining ?? 0),
    },
    restaurantTab: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({
          id: TAB_ID,
          status: 'OPEN',
          tableId: 'table',
        } as Partial<RestaurantTab>),
      update: jest.fn(),
    },
    restaurantTable: { update: jest.fn() },
    kitchenTicket: { create: jest.fn() },
  };
  const tenantPrisma = {
    run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const tabs = { loadTab: jest.fn().mockResolvedValue(tab) };
  const sales = {
    create: opts.saleError
      ? jest.fn().mockRejectedValue(opts.saleError)
      : jest
          .fn()
          .mockResolvedValue({
            id: 'sale-1',
            total: 200,
            payments: [{ method: 'CASH' }],
          }),
  };
  const auditLog = { logInTx: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new RestaurantTabPaymentsService(
    tenantPrisma as any,
    tabs as any,
    sales as any,
    auditLog as any,
  );
  return { service, tx, tabs, sales, auditLog };
}

const pay = (clientId: string, extra: Record<string, unknown> = {}) => ({
  clientId,
  payments: [{ method: 'CASH' as const, amount: 200 }],
  ...extra,
});

describe('RestaurantTabPaymentsService', () => {
  it('pays through the ordinary sale and closes the bill and sends the table to cleaning when nothing is left', async () => {
    const { service, sales, tx } = setup();
    const result = await service.close(TAB_ID, { ...pay('c1'), ...till });
    expect(sales.create).toHaveBeenCalledTimes(1);
    expect(sales.create.mock.calls[0][0]).toMatchObject({
      clientId: 'c1',
      branchId: 'branch',
      lineItems: [
        { variantId: `v-${LINE_A}`, quantity: 1 },
        { variantId: `v-${LINE_B}`, quantity: 1 },
      ],
    });
    expect(tx.restaurantTab.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CLOSED', saleId: 'sale-1' }),
      }),
    );
    expect(tx.restaurantTable.update).toHaveBeenCalledWith({
      where: { id: 'table' },
      data: { status: 'NEEDS_CLEANING' },
    });
    expect(result.closed).toBe(true);
  });

  it('never creates kitchen tickets when the bill is paid (they already exist)', async () => {
    const { service, tx } = setup();
    await service.close(TAB_ID, { ...pay('c1'), ...till });
    expect(tx.kitchenTicket.create).not.toHaveBeenCalled();
  });

  it('keeps the bill open when items are still unpaid (a part payment)', async () => {
    const { service, tx } = setup({ remaining: 1, claimCount: 1 });
    const result = await service.close(TAB_ID, {
      ...pay('c1', { lineIds: [LINE_A] }),
      ...till,
    });
    expect(tx.restaurantTab.update).not.toHaveBeenCalled();
    expect(tx.restaurantTable.update).not.toHaveBeenCalled();
    expect(result.closed).toBe(false);
  });

  it('answers a repeat of the same payment without charging again', async () => {
    const { service, sales } = setup({
      existingSale: { id: 'sale-1' },
      linked: { tabId: TAB_ID },
      tab: fullTab('CLOSED', [line(LINE_A, 'PAID')]),
    });
    const result = await service.close(TAB_ID, { ...pay('c1'), ...till });
    expect(sales.create).not.toHaveBeenCalled();
    expect(result.sale.id).toBe('sale-1');
  });

  it('refuses a payment id that was already used for a different bill', async () => {
    const { service, sales } = setup({
      existingSale: { id: 'sale-1' },
      linked: { tabId: 'another-tab' },
    });
    await expect(
      service.close(TAB_ID, { ...pay('c1'), ...till }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sales.create).not.toHaveBeenCalled();
  });

  it('refuses to charge a bill that is already paid under a different id', async () => {
    const { service, sales } = setup({
      tab: fullTab('CLOSED', [line(LINE_A, 'PAID')]),
    });
    await expect(
      service.close(TAB_ID, { ...pay('c2'), ...till }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sales.create).not.toHaveBeenCalled();
  });

  it('refuses when someone else holds the items right now (claim fails)', async () => {
    const { service, sales } = setup({ claimCount: 0 });
    await expect(
      service.close(TAB_ID, { ...pay('c1'), ...till }),
    ).rejects.toThrow(/Someone else/);
    expect(sales.create).not.toHaveBeenCalled();
  });

  it('lets go of the items when the sale is refused, and rethrows', async () => {
    const { service, tx } = setup({
      saleError: new BadRequestException(
        'Payments total 500.00 does not match sale total 200.00',
      ),
    });
    await expect(
      service.close(TAB_ID, { ...pay('c1'), ...till }),
    ).rejects.toThrow(/does not match/);
    expect(tx.restaurantTabLine.updateMany).toHaveBeenLastCalledWith({
      where: { tabId: TAB_ID, claimClientId: 'c1', status: 'ORDERED' },
      data: { claimClientId: null, claimedAt: null },
    });
  });

  it('refuses a voided item and an empty bill', async () => {
    await expect(
      setup({ tab: fullTab('OPEN', [line(LINE_A, 'VOIDED')]) }).service.close(
        TAB_ID,
        { ...pay('c1', { lineIds: [LINE_A] }), ...till },
      ),
    ).rejects.toThrow(/voided/);
    await expect(
      setup({ tab: fullTab('OPEN', [line(LINE_A, 'VOIDED')]) }).service.close(
        TAB_ID,
        { ...pay('c1'), ...till },
      ),
    ).rejects.toThrow(/nothing unpaid/);
  });

  it('refuses a bill that was thrown away', async () => {
    await expect(
      setup({ tab: fullTab('VOID', []) }).service.close(TAB_ID, {
        ...pay('c1'),
        ...till,
      }),
    ).rejects.toThrow(/thrown away/);
  });

  describe('split bill', () => {
    it('needs every person to be given items, and no item to two people', async () => {
      const { service } = setup();
      const base = { ...till };
      await expect(
        service.closeSplit(TAB_ID, { ...base, payers: [pay('c1')] }),
      ).rejects.toThrow(/given their items/);
      await expect(
        service.closeSplit(TAB_ID, {
          ...base,
          payers: [
            pay('c1', { lineIds: [LINE_A] }),
            pay('c2', { lineIds: [LINE_A, LINE_B] }),
          ],
        }),
      ).rejects.toThrow(/two people/);
      await expect(
        service.closeSplit(TAB_ID, {
          ...base,
          payers: [
            pay('c1', { lineIds: [LINE_A] }),
            pay('c1', { lineIds: [LINE_B] }),
          ],
        }),
      ).rejects.toThrow(/own id/);
    });

    it('makes one sale per person', async () => {
      const { service, sales } = setup({ claimCount: 1, remaining: 0 });
      const result = await service.closeSplit(TAB_ID, {
        ...till,
        payers: [
          pay('c1', { lineIds: [LINE_A], label: 'Wanjiru' }),
          pay('c2', { lineIds: [LINE_B], label: 'Otieno' }),
        ],
      });
      expect(sales.create).toHaveBeenCalledTimes(2);
      expect(result.payments).toHaveLength(2);
    });

    it('says which earlier payments were made when a later one fails', async () => {
      const { service, sales } = setup({ claimCount: 1 });
      sales.create
        .mockResolvedValueOnce({ id: 'sale-1', total: 100, payments: [] })
        .mockRejectedValueOnce(new BadRequestException('Not enough stock'));
      await expect(
        service.closeSplit(TAB_ID, {
          ...till,
          payers: [
            pay('c1', { lineIds: [LINE_A] }),
            pay('c2', { lineIds: [LINE_B], label: 'Otieno' }),
          ],
        }),
      ).rejects.toThrow(
        /Otieno's payment did not go through.*1 earlier payment was made/,
      );
    });
  });
});
