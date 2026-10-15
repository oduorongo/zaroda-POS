import { RentalPlatformBillingService } from './rental-platform-billing.service';

// 09:00 Nairobi on the 1st of the month.
const NOV_1 = new Date('2026-11-01T06:00:00Z');
const DEC_1 = new Date('2026-12-01T06:00:00Z');

interface World {
  settings?: Record<string, unknown> | null;
  occupied?: number;
  matchedPayments?: number[]; // amounts of payments that came from a paid M-Pesa prompt, dated in the previous month
}

const STARTER = { plan: 'starter', billingCycle: 'monthly', pendingPlan: null, pendingPlanFrom: null, planFreeUntil: null };
const COLLECT = { ...STARTER, plan: 'collect' };

function fakeTx(world: World) {
  const invoices: Record<string, unknown>[] = [];
  const settings = world.settings === undefined ? STARTER : world.settings;
  const tx = {
    rentalSettings: {
      findUnique: jest.fn(async () => settings),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...(settings as object), ...data })),
    },
    rentalLease: { count: jest.fn(async () => world.occupied ?? 0) },
    rentalPaymentRequest: { findMany: jest.fn(async () => (world.matchedPayments ?? []).map((_, i) => ({ paymentId: `pay-${i}` }))) },
    rentalPayment: { findMany: jest.fn(async () => (world.matchedPayments ?? []).map((amount) => ({ amount }))) },
    rentalPlatformInvoice: {
      findFirst: jest.fn(
        async ({ where }: { where: { kind: string; periodStart: { lte: Date } } }) =>
          invoices.find((i) => i.kind === where.kind && (i.periodStart as Date) <= where.periodStart.lte && (i.periodEnd as Date) > where.periodStart.lte) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const key = where.organizationId_kind_invoiceMonth as { kind: string; invoiceMonth: string } | undefined;
        if (key) return invoices.find((i) => i.kind === key.kind && i.invoiceMonth === key.invoiceMonth) ?? null;
        return invoices.find((i) => i.invoiceNumber === where.invoiceNumber) ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `inv-${invoices.length + 1}`, ...data };
        invoices.push(row);
        return row;
      }),
    },
  };
  return { tx: tx as never, created: invoices, raw: tx };
}

const build = (enforce = true) =>
  new RentalPlatformBillingService({} as never, {} as never, {} as never, { get: (k: string) => (k === 'RENTAL_ENFORCE_READ_ONLY' && enforce ? 'on' : undefined) } as never);

describe('RentalPlatformBillingService.generateForOrganization', () => {
  it('issues nothing to a landlord on the free Bure plan, or with no settings', async () => {
    const a = fakeTx({ settings: { ...STARTER, plan: 'bure' } });
    expect(await build().generateForOrganization(a.tx, 'org-1', NOV_1)).toEqual([]);
    const b = fakeTx({ settings: null });
    expect(await build().generateForOrganization(b.tx, 'org-1', NOV_1)).toEqual([]);
  });

  it('issues a 1,000 Starter invoice on the 1st with the occupied-unit count, due on the 15th', async () => {
    const w = fakeTx({ occupied: 12 });
    expect(await build().generateForOrganization(w.tx, 'org-1', NOV_1)).toHaveLength(1);
    expect(w.created[0]).toMatchObject({ kind: 'SUBSCRIPTION', invoiceMonth: '2026-11', amountDue: 1000, occupiedUnits: 12, plan: 'starter', billingCycle: 'monthly' });
    expect((w.created[0].dueDate as Date).toISOString()).toBe('2026-11-14T21:00:00.000Z'); // 15 Nov 00:00 Nairobi
    expect(String(w.created[0].invoiceNumber)).toMatch(/^ZRB-202611-/);
  });

  it('counts occupied units on the 1st of the invoice month', async () => {
    const w = fakeTx({ occupied: 3 });
    await build().generateForOrganization(w.tx, 'org-1', NOV_1);
    const first = new Date('2026-11-01T00:00:00Z');
    expect(w.raw.rentalLease.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', startDate: { lte: first }, OR: [{ endedAt: null }, { endedAt: { gt: first } }] },
    });
  });

  it('does not issue the same invoice twice', async () => {
    const w = fakeTx({});
    const svc = build();
    await svc.generateForOrganization(w.tx, 'org-1', NOV_1);
    await svc.generateForOrganization(w.tx, 'org-1', new Date(NOV_1.getTime() + 3600_000));
    expect(w.created).toHaveLength(1);
  });

  it('bills annual Starter 10,000 once, then nothing for the next 11 months', async () => {
    const w = fakeTx({ settings: { ...STARTER, billingCycle: 'annual' } });
    const svc = build();
    await svc.generateForOrganization(w.tx, 'org-1', NOV_1);
    expect(w.created[0]).toMatchObject({ amountDue: 10000, billingCycle: 'annual' });
    await svc.generateForOrganization(w.tx, 'org-1', DEC_1);
    expect(w.created).toHaveLength(1);
  });

  it('charges Pay-as-you-collect 1% of last month gateway rent, rounded up, and records the total', async () => {
    const w = fakeTx({ settings: COLLECT, matchedPayments: [20000, 15000.5, 5000] });
    await build().generateForOrganization(w.tx, 'org-1', NOV_1);
    expect(w.created).toHaveLength(1);
    // 40,000.50 collected: 1% is 400.005, rounded up to a whole shilling.
    expect(w.created[0]).toMatchObject({ kind: 'COLLECTION_FEE', amountDue: 401, matchedRentTotal: 40000.5 });
  });

  it('issues no collection invoice when nothing was collected through the gateway', async () => {
    const w = fakeTx({ settings: COLLECT, matchedPayments: [] });
    expect(await build().generateForOrganization(w.tx, 'org-1', NOV_1)).toEqual([]);
  });

  it('does not charge existing landlords for October (free period), but does for November', async () => {
    const settings = { ...COLLECT, planFreeUntil: new Date('2026-10-31T20:59:59Z') };
    const nov = fakeTx({ settings, matchedPayments: [100000] });
    expect(await build().generateForOrganization(nov.tx, 'org-1', NOV_1)).toEqual([]); // October rent: free
    const dec = fakeTx({ settings, matchedPayments: [100000] });
    expect(await build().generateForOrganization(dec.tx, 'org-1', DEC_1)).toHaveLength(1); // November rent: billed
    expect(dec.created[0]).toMatchObject({ amountDue: 1000 });
  });

  it('holds back a Starter fee for a month that falls inside the free period', async () => {
    const w = fakeTx({ settings: { ...STARTER, planFreeUntil: new Date('2026-11-30T20:59:59Z') } });
    expect(await build().generateForOrganization(w.tx, 'org-1', NOV_1)).toEqual([]);
  });

  it('bills the new plan once a waiting move down has reached its date, and saves that plan', async () => {
    const w = fakeTx({ settings: { ...COLLECT, pendingPlan: 'starter', pendingPlanFrom: NOV_1 } });
    await build().generateForOrganization(w.tx, 'org-1', NOV_1);
    expect(w.raw.rentalSettings.update).toHaveBeenCalledWith({ where: { organizationId: 'org-1' }, data: { plan: 'starter', pendingPlan: null, pendingPlanFrom: null } });
    expect(w.created[0]).toMatchObject({ kind: 'SUBSCRIPTION', amountDue: 1000 });
  });
});

describe('RentalPlatformBillingService.isReadOnly', () => {
  const txWith = (overdue: { status: 'ISSUED'; dueDate: Date }[]) => ({ rentalPlatformInvoice: { findMany: jest.fn(async () => overdue) } }) as never;

  it('is read-only with an unpaid invoice past its due date, and not otherwise', async () => {
    const past = { status: 'ISSUED' as const, dueDate: new Date('2026-11-14T21:00:00Z') };
    expect(await build().isReadOnly(txWith([past]), 'org-1', new Date('2026-11-15T09:00:00Z'))).toBe(true);
    expect(await build().isReadOnly(txWith([]), 'org-1', new Date('2026-11-15T09:00:00Z'))).toBe(false);
  });
});

describe('RentalPlatformBillingService.enforcesReadOnly', () => {
  it('is off unless RENTAL_ENFORCE_READ_ONLY=on', () => {
    expect(build(false).enforcesReadOnly()).toBe(false);
    expect(build(true).enforcesReadOnly()).toBe(true);
  });
});
