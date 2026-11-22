import { ForbiddenException } from '@nestjs/common';
import { AppIncomeSyncController } from './app-income.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */
const KEY = 'b'.repeat(32);
const setup = (keys: Record<string, string>) => {
  const createMany = jest.fn(async ({ data }: any) => ({ count: data.length }));
  const controller = new AppIncomeSyncController({ appIncomeReceipt: { createMany } } as any, { get: (k: string) => keys[k] } as any);
  return { controller, createMany };
};
const receipt = { id: 'pay-1', payer: 'Agape Hardware', description: 'Zaroda Books subscription', amountKes: 500, paidAt: '2027-01-20T09:00:00Z', reference: ' QAB12CD ' };

describe('income from ZARODA\'s other apps', () => {
  it('stores each receipt once under "<app>:<id>" when the app\'s own key matches', async () => {
    const { controller, createMany } = setup({ BOOKS_INCOME_SYNC_KEY: KEY });
    const out = await controller.sync({ headers: { 'x-income-sync-key': KEY } } as any, { app: 'BOOKS', receipts: [receipt] });
    expect(out).toEqual({ received: 1, added: 1 });
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: 'BOOKS:pay-1', app: 'BOOKS', amountKes: 500, reference: 'QAB12CD' })],
      skipDuplicates: true,
    });
  });

  it('refuses a wrong key, another app\'s key, or a missing setting', async () => {
    const { controller, createMany } = setup({ BOOKS_INCOME_SYNC_KEY: KEY, SPORTS_INCOME_SYNC_KEY: 'c'.repeat(32) });
    await expect(controller.sync({ headers: { 'x-income-sync-key': 'x'.repeat(32) } } as any, { app: 'BOOKS', receipts: [receipt] })).rejects.toThrow(ForbiddenException);
    await expect(controller.sync({ headers: { 'x-income-sync-key': KEY } } as any, { app: 'SPORTS', receipts: [receipt] })).rejects.toThrow(/SPORTS_INCOME_SYNC_KEY/);
    await expect(controller.sync({ headers: { 'x-income-sync-key': KEY } } as any, { app: 'EVENTS', receipts: [receipt] })).rejects.toThrow(/EVENTS_INCOME_SYNC_KEY is not set/);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('School\'s professional records wallet uses the key School already has', async () => {
    const { controller } = setup({ SCHOOL_SALES_SYNC_KEY: KEY });
    await expect(controller.sync({ headers: { 'x-income-sync-key': KEY } } as any, { app: 'SCHOOL_RECORDS', receipts: [receipt] })).resolves.toEqual({ received: 1, added: 1 });
  });
});
