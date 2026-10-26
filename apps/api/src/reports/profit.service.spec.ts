import { BadRequestException } from '@nestjs/common';
import { ProfitService } from './profit.service';

type Line = { quantity: number; taxAmount: number; cost: number | null; ingredients?: { quantity: number; cost: number | null }[] };
const sale = (iso: string, total: number, lines: Line[]) => ({
  createdAt: new Date(iso),
  total,
  lineItems: lines.map((l) => ({
    quantity: l.quantity,
    taxAmount: l.taxAmount,
    variant: { cost: l.cost },
    ingredients: (l.ingredients ?? []).map((i) => ({ quantity: i.quantity, ingredientVariant: { cost: i.cost } })),
  })),
});

function setup(data: { sales?: unknown[]; refunds?: unknown[]; wastes?: unknown[]; expenses?: unknown[]; payroll?: unknown[]; schoolInvoices?: unknown[]; writeOffs?: unknown[]; bills?: unknown[]; supplierPayments?: unknown[]; owing?: unknown[] } = {}) {
  const tx = {
    sale: { findMany: jest.fn().mockResolvedValue(data.sales ?? []) },
    refund: { findMany: jest.fn().mockResolvedValue(data.refunds ?? []) },
    wasteLog: { findMany: jest.fn().mockResolvedValue(data.wastes ?? []) },
    expense: { findMany: jest.fn().mockResolvedValue(data.expenses ?? []) },
    payrollRun: { findMany: jest.fn().mockResolvedValue(data.payroll ?? []) },
    supplierInvoice: { findMany: jest.fn().mockResolvedValue(data.schoolInvoices ?? []) },
    schoolWriteOff: { findMany: jest.fn().mockResolvedValue(data.writeOffs ?? []) },
    supplierBill: { findMany: jest.fn().mockResolvedValueOnce(data.bills ?? []).mockResolvedValueOnce(data.owing ?? []) },
    supplierBillPayment: { findMany: jest.fn().mockResolvedValue(data.supplierPayments ?? []) },
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new ProfitService(tenantPrisma as any), tx };
}

describe('ProfitService', () => {
  it('shows stock buying beside the profit but never takes it off (the cost of stock is counted when it is sold)', async () => {
    const { service } = setup({
      sales: [sale('2026-10-21T07:00:00Z', 1000, [{ quantity: 1, taxAmount: 0, cost: 400 }])],
      bills: [{ total: 5000, creditAmount: 500 }, { total: 2000, creditAmount: 0 }],
      supplierPayments: [{ amount: 3000 }, { amount: 1000 }],
      owing: [{ total: 5000, creditAmount: 500, amountPaid: 1000 }, { total: 2000, creditAmount: 0, amountPaid: 0 }],
    });
    const r = await service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(r.stockBuying).toEqual({ billed: 6500, paidToSuppliers: 4000, owedNow: 5500 });
    expect(r.totals.netProfit).toBe(600); // 1000 - 400: the bills and payments do not change it
    expect(r.totals.expenses).toBe(0);
  });

  it('leaves stock buying out when looking at one branch (bills belong to the business)', async () => {
    const { service } = setup({});
    expect((await service.profit({ from: '2026-10-21', to: '2026-10-21', branchId: 'b1' })).stockBuying).toBeNull();
  });

  it('works out net sales, gross profit and net profit for a day', async () => {
    const { service } = setup({
      // two sales: KES 1,160 (incl. KES 160 tax) with goods that cost 600, and KES 500 with goods that cost 300
      sales: [sale('2026-10-21T07:00:00Z', 1160, [{ quantity: 2, taxAmount: 160, cost: 300 }]), sale('2026-10-21T09:00:00Z', 500, [{ quantity: 1, taxAmount: 0, cost: 300 }])],
      refunds: [{ amount: 100, createdAt: new Date('2026-10-21T10:00:00Z') }],
      wastes: [{ totalCost: 50, createdAt: new Date('2026-10-21T11:00:00Z') }],
      expenses: [{ spentOn: new Date('2026-10-21T00:00:00Z'), amount: 200, category: 'TRANSPORT' }, { spentOn: new Date('2026-10-21T00:00:00Z'), amount: 150, category: 'UTILITIES' }],
    });
    const r = await service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(r.totals).toEqual({
      saleCount: 2,
      sales: 1660,
      tax: 160,
      refunds: 100,
      netSales: 1400, // 1660 - 160 - 100
      costOfGoods: 900, // 2 x 300 + 300
      grossProfit: 500,
      waste: 50,
      expenses: 350,
      payroll: 0,
      badDebts: 0,
      netProfit: 100, // 500 - 50 - 350
    });
    expect(r.expensesByCategory).toEqual([
      { category: 'TRANSPORT', label: 'Transport and fuel', amount: 200 },
      { category: 'UTILITIES', label: 'Electricity, water and internet', amount: 150 },
    ]);
    expect(r.costNote).toBeNull();
  });

  it('splits a week into days, with a row for a quiet day, and the days add up to the total', async () => {
    const { service } = setup({
      sales: [sale('2026-10-19T07:00:00Z', 1000, [{ quantity: 1, taxAmount: 0, cost: 600 }]), sale('2026-10-22T07:00:00Z', 2000, [{ quantity: 1, taxAmount: 0, cost: 1000 }])],
      expenses: [{ spentOn: new Date('2026-10-20T00:00:00Z'), amount: 300, category: 'RENT' }],
    });
    const r = await service.profit({ from: '2026-10-19', to: '2026-10-25', groupBy: 'day' });
    expect(r.periods.map((p) => p.key)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(r.periods[1]).toMatchObject({ sales: 0, expenses: 300, netProfit: -300 });
    expect(r.periods[2]).toMatchObject({ saleCount: 0, netProfit: 0 });
    expect(r.periods.reduce((sum, p) => sum + p.netProfit, 0)).toBe(r.totals.netProfit);
    expect(r.totals.netProfit).toBe(1000 - 600 + (2000 - 1000) - 300);
  });

  it('groups by week (Monday to Sunday) and by month', async () => {
    const sales = [sale('2026-10-25T07:00:00Z', 100, []), sale('2026-10-26T07:00:00Z', 200, []), sale('2026-11-02T07:00:00Z', 400, [])];
    const weekly = await setup({ sales }).service.profit({ from: '2026-10-19', to: '2026-11-08', groupBy: 'week' });
    expect(weekly.periods.map((p) => [p.key, p.sales])).toEqual([['2026-10-19', 100], ['2026-10-26', 200], ['2026-11-02', 400]]);
    const monthly = await setup({ sales }).service.profit({ from: '2026-10-01', to: '2026-11-30', groupBy: 'month' });
    expect(monthly.periods.map((p) => [p.key, p.sales])).toEqual([['2026-10', 300], ['2026-11', 400]]);
  });

  it('puts a sale made after 9pm UTC on the next Nairobi day', async () => {
    const { service } = setup({ sales: [sale('2026-10-21T21:30:00Z', 100, [])] });
    const r = await service.profit({ from: '2026-10-21', to: '2026-10-22', groupBy: 'day' });
    expect(r.periods.map((p) => [p.key, p.sales])).toEqual([['2026-10-21', 0], ['2026-10-22', 100]]);
  });

  it('says so when some products have no cost, instead of pretending those sales cost nothing', async () => {
    const { service } = setup({ sales: [sale('2026-10-21T07:00:00Z', 1000, [{ quantity: 1, taxAmount: 0, cost: 400 }, { quantity: 3, taxAmount: 0, cost: null }])] });
    const r = await service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(r.totals.costOfGoods).toBe(400);
    expect(r.unknownCostLines).toBe(1);
    expect(r.costNote).toMatch(/no cost entered/);
  });

  it('costs a recipe dish from what it used, and flags it when any ingredient has no cost', async () => {
    const known = await setup({ sales: [sale('2026-10-21T07:00:00Z', 500, [{ quantity: 1, taxAmount: 0, cost: null, ingredients: [{ quantity: 0.5, cost: 100 }, { quantity: 2, cost: 20 }] }])] }).service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(known.totals.costOfGoods).toBe(90);
    const unknown = await setup({ sales: [sale('2026-10-21T07:00:00Z', 500, [{ quantity: 1, taxAmount: 0, cost: null, ingredients: [{ quantity: 1, cost: null }] }])] }).service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(unknown.unknownCostLines).toBe(1);
  });

  it('counts invoices to schools as sales on the day they are issued, with the cost of the goods, but not for a single branch', async () => {
    const schoolInvoices = [
      { issueDate: new Date('2026-10-21T00:00:00Z'), total: 4600, taxAmount: 0, lines: [{ quantity: 80, unitCost: 30 }, { quantity: 50, unitCost: 10 }] },
      { issueDate: new Date('2026-10-21T00:00:00Z'), total: 1160, taxAmount: 160, lines: [{ quantity: 10, unitCost: null }] },
    ];
    const all = await setup({ schoolInvoices }).service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(all.totals.sales).toBe(5760);
    expect(all.totals.tax).toBe(160);
    expect(all.totals.costOfGoods).toBe(2900);
    expect(all.totals.netSales).toBe(5600);
    expect(all.unknownCostLines).toBe(1);
    const branch = setup({ schoolInvoices });
    const one = await branch.service.profit({ from: '2026-10-21', to: '2026-10-21', branchId: '11111111-1111-1111-1111-111111111111' });
    expect(one.totals.sales).toBe(0);
    expect(branch.tx.supplierInvoice.findMany).not.toHaveBeenCalled();
  });

  it('counts only the invoices that were NOT also recorded as a sale (the others are in the sales already, so they are not counted twice)', async () => {
    const t = setup({});
    await t.service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(t.tx.supplierInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ saleId: null }) }));
  });

  it('counts salaries paid through Payroll, but not for a single branch', async () => {
    const payroll = [{ paidAt: new Date('2026-10-21T07:00:00Z'), payslips: [{ grossPay: 20000 }, { grossPay: 15000 }] }];
    const all = await setup({ payroll }).service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(all.totals.payroll).toBe(35000);
    expect(all.totals.netProfit).toBe(-35000);
    const branch = setup({ payroll });
    const one = await branch.service.profit({ from: '2026-10-21', to: '2026-10-21', branchId: '11111111-1111-1111-1111-111111111111' });
    expect(one.totals.payroll).toBe(0);
    expect(branch.tx.payrollRun.findMany).not.toHaveBeenCalled();
  });

  it('takes debts written off off the profit on the day they were approved, and gives back any put back, but not for a single branch', async () => {
    const writeOffs = [
      { amount: 5000, status: 'APPROVED', decidedAt: new Date('2026-10-21T07:00:00Z'), reversedAt: null },
      { amount: 1000, status: 'REVERSED', decidedAt: new Date('2026-10-20T07:00:00Z'), reversedAt: new Date('2026-10-21T08:00:00Z') },
    ];
    const all = await setup({ writeOffs }).service.profit({ from: '2026-10-21', to: '2026-10-21' });
    // 5000 written off today; the 1000 was written off yesterday (outside) and put back today
    expect(all.totals.badDebts).toBe(4000);
    expect(all.totals.netProfit).toBe(-4000);
    const branch = setup({ writeOffs });
    const one = await branch.service.profit({ from: '2026-10-21', to: '2026-10-21', branchId: '11111111-1111-1111-1111-111111111111' });
    expect(one.totals.badDebts).toBe(0);
    expect(branch.tx.schoolWriteOff.findMany).not.toHaveBeenCalled();
  });

  it('passes the branch filter to sales, waste and expenses', async () => {
    const { service, tx } = setup();
    await service.profit({ from: '2026-10-21', to: '2026-10-21', branchId: '11111111-1111-1111-1111-111111111111' });
    expect(tx.sale.findMany.mock.calls[0][0].where.branchId).toBe('11111111-1111-1111-1111-111111111111');
    expect(tx.wasteLog.findMany.mock.calls[0][0].where.branchId).toBe('11111111-1111-1111-1111-111111111111');
    expect(tx.expense.findMany.mock.calls[0][0].where.branchId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('only counts completed sales, never voided ones', async () => {
    const { service, tx } = setup();
    await service.profit({ from: '2026-10-21', to: '2026-10-21' });
    expect(tx.sale.findMany.mock.calls[0][0].where.status).toBe('COMPLETED');
  });

  it('refuses a broken range', async () => {
    const { service } = setup();
    await expect(service.profit({ from: '2026-10-31', to: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.profit({ from: '2025-01-01', to: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
