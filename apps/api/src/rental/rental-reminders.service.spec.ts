import { Prisma } from '@prisma/client';
import { RentalRemindersService } from './rental-reminders.service';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A tiny in-memory stand-in for the database: just enough for one landlord's reminder pass. */
function fakeWorld(opts: { enabled?: boolean; sms?: boolean; tenantEmail?: string | null; tenantPhone?: string | null; dueDate?: string; paid?: number } = {}) {
  const logs = new Map<string, { id: string; invoiceId: string; stage: string; channel: string }>();
  let nextId = 1;
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    rentalSettings: {
      findUnique: jest.fn(async () => ({
        remindersEnabled: opts.enabled ?? true,
        smsReminders: opts.sms ?? false,
        paymentInstructions: 'Paybill 123456',
      })),
    },
    organization: { findUnique: jest.fn(async () => ({ name: 'Zaroda Apartments' })) },
    rentalLease: {
      findMany: jest.fn(async () => [
        {
          id: 'lease-1',
          tenant: { name: 'Wanjiku Kamau', phone: opts.tenantPhone === undefined ? '0712345678' : opts.tenantPhone, email: opts.tenantEmail === undefined ? 'w@example.test' : opts.tenantEmail },
          unit: { label: 'A4', property: { name: 'Kilimani Court' } },
          invoices: [
            {
              id: 'inv-1',
              kind: 'RENT',
              description: 'Rent for October 2026',
              amountDue: new Prisma.Decimal(10000),
              amountPaid: new Prisma.Decimal(opts.paid ?? 0),
              dueDate: d(opts.dueDate ?? '2026-10-05'),
            },
          ],
        },
      ]),
    },
    rentalReminderLog: {
      create: jest.fn(async ({ data }: { data: { invoiceId: string; stage: string; channel: string } }) => {
        const key = `${data.invoiceId}|${data.stage}|${data.channel}`;
        if (logs.has(key)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        const row = { id: String(nextId++), ...data };
        logs.set(key, row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: { where: { id: string } }) => {
        for (const [k, v] of logs) if (v.id === where.id) logs.delete(k);
        return { count: 1 };
      }),
    },
  };
  const prisma = { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { tx, prisma, logs };
}

function build(world: ReturnType<typeof fakeWorld>, deps: { emailOk?: boolean; smsOk?: boolean; emailConfigured?: boolean } = {}) {
  const email = { isConfigured: () => deps.emailConfigured ?? true, sendEmail: jest.fn(async (_msg: { to: string }) => ({ sent: deps.emailOk ?? true })) };
  const sms = { sendSms: jest.fn(async (_msg: { to: string; message: string }) => ({ sent: deps.smsOk ?? true })) };
  const config = { get: (k: string) => (k.startsWith('AFRICAS_TALKING') ? 'set' : undefined) };
  const service = new RentalRemindersService(world.prisma as never, {} as never, email as never, sms as never, config as never);
  return { service, email, sms };
}

// 10:00 Nairobi on 14 Oct 2026 (07:00 UTC), invoice due 5 Oct => 9 days late => OVERDUE stage.
const DAYTIME = new Date('2026-10-14T07:00:00Z');

describe('RentalRemindersService.runForOrganization', () => {
  it('emails an overdue tenant once and never again', async () => {
    const world = fakeWorld();
    const { service, email } = build(world);
    expect(await service.runForOrganization('org-1', DAYTIME)).toBe(1);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'w@example.test' });
    // the hourly job runs again: nothing more goes out
    expect(await service.runForOrganization('org-1', new Date(DAYTIME.getTime() + 3600_000))).toBe(0);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the landlord has not switched reminders on', async () => {
    const world = fakeWorld({ enabled: false });
    const { service, email } = build(world);
    expect(await service.runForOrganization('org-1', DAYTIME)).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('stays quiet at night (Nairobi time)', async () => {
    const world = fakeWorld();
    const { service, email } = build(world);
    // 23:30 UTC = 02:30 Nairobi
    expect(await service.runForOrganization('org-1', new Date('2026-10-14T23:30:00Z'))).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('does not remind a tenant who has paid', async () => {
    const world = fakeWorld({ paid: 10000 });
    const { service, email } = build(world);
    expect(await service.runForOrganization('org-1', DAYTIME)).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('does not remind about rent that is not due for more than 3 days', async () => {
    const world = fakeWorld({ dueDate: '2026-10-25' });
    const { service, email } = build(world);
    expect(await service.runForOrganization('org-1', DAYTIME)).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('gives the claim back when the email fails, so the next run retries', async () => {
    const world = fakeWorld();
    const failing = build(world, { emailOk: false });
    expect(await failing.service.runForOrganization('org-1', DAYTIME)).toBe(0);
    expect(world.logs.size).toBe(0);
    const working = build(world, { emailOk: true });
    expect(await working.service.runForOrganization('org-1', DAYTIME)).toBe(1);
  });

  it('skips a tenant with no email address, and sends SMS only when the landlord turned it on', async () => {
    const noEmail = fakeWorld({ tenantEmail: null });
    const a = build(noEmail);
    expect(await a.service.runForOrganization('org-1', DAYTIME)).toBe(0);
    expect(a.sms.sendSms).not.toHaveBeenCalled();

    const withSms = fakeWorld({ tenantEmail: null, sms: true });
    const b = build(withSms);
    expect(await b.service.runForOrganization('org-1', DAYTIME)).toBe(1);
    expect(b.sms.sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: '+254712345678' }));
  });

  it('does nothing when no email provider is set up', async () => {
    const world = fakeWorld();
    const { service, email } = build(world, { emailConfigured: false });
    // SMS off in this world and email unconfigured => nothing to do at all
    expect(await service.runForOrganization('org-1', DAYTIME)).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});
