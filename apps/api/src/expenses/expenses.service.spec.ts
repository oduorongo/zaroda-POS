import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { ExpensesService } from './expenses.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const asOwner = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, fn);
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 3 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'e1', organizationId: ORG, branchId: null, spentOn: new Date(`${daysAgo(1)}T00:00:00Z`), category: 'RENT', description: null,
  amount: 5000, paidWith: null, recordedById: 'ou-1', createdAt: new Date(), updatedAt: new Date(), branch: null, ...extra,
});

function setup(opts: { existing?: ReturnType<typeof row> | null; rows?: ReturnType<typeof row>[] } = {}) {
  const tx = {
    branch: { findUnique: jest.fn().mockResolvedValue({ id: 'b1' }) },
    expense: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
      findMany: jest.fn().mockResolvedValue(opts.rows ?? []),
      findUnique: jest.fn().mockResolvedValue('existing' in opts ? opts.existing : row()),
      // Prisma ignores fields left undefined, so the pretend update does too.
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))))),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const audit = { logInTx: jest.fn().mockResolvedValue(undefined) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new ExpensesService(tenantPrisma as any, audit as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx, audit };
}

describe('ExpensesService', () => {
  it('records an expense against a calendar day, with who recorded it, and leaves an audit entry', async () => {
    const { service, tx, audit } = setup();
    const view = await asOwner(() => service.create({ spentOn: daysAgo(1), category: 'TRANSPORT', amount: 1500.5, description: '  Fuel for the van ' }));
    const data = tx.expense.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ organizationId: ORG, category: 'TRANSPORT', amount: 1500.5, description: 'Fuel for the van', recordedById: 'ou-1', branchId: null });
    expect(data.spentOn.toISOString()).toBe(`${daysAgo(1)}T00:00:00.000Z`);
    expect(view.categoryLabel).toBeDefined();
    expect(audit.logInTx.mock.calls[0][1].action).toBe('expense.created');
  });

  it('refuses a date in the future and one years ago', async () => {
    const { service } = setup();
    const tomorrow = new Date(Date.now() + 3 * 3600_000 + 2 * 86_400_000).toISOString().slice(0, 10);
    await expect(asOwner(() => service.create({ spentOn: tomorrow, category: 'RENT', amount: 100 }))).rejects.toThrow(/future/);
    await expect(asOwner(() => service.create({ spentOn: '2015-01-01', category: 'RENT', amount: 100 }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts today', async () => {
    const { service } = setup();
    await expect(asOwner(() => service.create({ spentOn: today(), category: 'RENT', amount: 100 }))).resolves.toBeDefined();
  });

  it('refuses a branch that is not this business', async () => {
    const { service, tx } = setup();
    tx.branch.findUnique.mockResolvedValue(null);
    await expect(asOwner(() => service.create({ spentOn: daysAgo(0), category: 'RENT', amount: 100, branchId: 'b-other' }))).rejects.toThrow('Branch not found');
  });

  it('lists with a total and a breakdown by category, biggest first', async () => {
    const { service } = setup({ rows: [row({ amount: 1000, category: 'RENT' }), row({ id: 'e2', amount: 300, category: 'AIRTIME' }), row({ id: 'e3', amount: 4000, category: 'RENT' })] });
    const r = await asOwner(() => service.list({}));
    expect(r.total).toBe(5300);
    expect(r.byCategory.map((c) => [c.category, c.amount])).toEqual([['RENT', 5000], ['AIRTIME', 300]]);
  });

  it('audits an edit with the before and after, and a delete with what was removed', async () => {
    const edit = setup();
    await asOwner(() => edit.service.update('e1', { amount: 6000 }));
    expect(edit.audit.logInTx.mock.calls[0][1]).toMatchObject({ action: 'expense.updated', before: { amount: 5000 } });
    const del = setup();
    await asOwner(() => del.service.remove('e1'));
    expect(del.audit.logInTx.mock.calls[0][1]).toMatchObject({ action: 'expense.deleted', before: { amount: 5000 } });
    expect(del.tx.expense.delete).toHaveBeenCalled();
  });

  it('says so when the expense is not found', async () => {
    const { service } = setup({ existing: null });
    await expect(asOwner(() => service.update('nope', { amount: 1 }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(asOwner(() => service.remove('nope'))).rejects.toBeInstanceOf(NotFoundException);
  });
});
