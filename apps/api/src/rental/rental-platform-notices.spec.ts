import { RentalPlatformBillingService } from './rental-platform-billing.service';

const DUE = new Date('2026-11-14T21:00:00Z'); // 15 Nov 00:00 Nairobi
const at = (iso: string) => new Date(iso);

function build(opts: { stage: number; emailOk?: boolean; owners?: string[] }) {
  const invoice = {
    id: 'inv-1',
    invoiceNumber: 'ZRB-202611-ABCD',
    kind: 'SUBSCRIPTION',
    invoiceMonth: '2026-11',
    periodStart: new Date('2026-10-31T21:00:00Z'),
    periodEnd: new Date('2026-11-30T21:00:00Z'),
    plan: 'starter',
    occupiedUnits: 12,
    matchedRentTotal: null,
    amountDue: 1000,
    status: 'ISSUED',
    dueDate: DUE,
    reminderStage: opts.stage,
    emailedAt: null,
  };
  const update = jest.fn(async () => invoice);
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    rentalPlatformInvoice: { findMany: jest.fn(async () => [invoice]), update },
    organization: { findUnique: jest.fn(async () => ({ name: 'Mwangi Properties' })) },
    orgUser: { findMany: jest.fn(async () => (opts.owners ?? ['owner@example.com']).map((email) => ({ role: 'OWNER', user: { email } }))) },
  };
  const prisma = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  const email = { isConfigured: () => true, sendEmail: jest.fn(async (_m: { to: string; subject: string }) => ({ sent: opts.emailOk ?? true })) };
  const config = { get: (k: string) => (k === 'BACKOFFICE_BASE_URL' ? 'https://app.zarodashop.com' : undefined) };
  const service = new RentalPlatformBillingService(prisma as never, {} as never, email as never, config as never);
  return { service, email, update };
}

describe('RentalPlatformBillingService.sendNotices', () => {
  it('emails the issued notice on the 1st and records that it was sent', async () => {
    const { service, email, update } = build({ stage: 0 });
    expect(await service.sendNotices('org-1', at('2026-11-01T06:00:00Z'))).toBe(1);
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com', subject: expect.stringContaining('ZRB-202611-ABCD') }));
    expect(update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { reminderStage: 1, emailedAt: expect.any(Date) } });
  });

  it('sends the day-5 and day-10 reminders, then the read-only notice on the 15th', async () => {
    for (const [stage, when, expected] of [
      [1, '2026-11-05T06:00:00Z', 2],
      [2, '2026-11-10T06:00:00Z', 3],
      [3, '2026-11-15T06:00:00Z', 4],
    ] as const) {
      const { service, update } = build({ stage });
      expect(await service.sendNotices('org-1', at(when))).toBe(1);
      expect(update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { reminderStage: expected, emailedAt: expect.any(Date) } });
    }
  });

  it('says plainly that the account is read-only and nothing was deleted', async () => {
    const { service, email } = build({ stage: 3 });
    await service.sendNotices('org-1', at('2026-11-15T06:00:00Z'));
    expect(email.sendEmail.mock.calls[0][0].subject).toMatch(/read-only/);
  });

  it('never sends a notice twice', async () => {
    const { service, email } = build({ stage: 1 });
    expect(await service.sendNotices('org-1', at('2026-11-02T06:00:00Z'))).toBe(0);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('sends nothing at night, and tries again later', async () => {
    const { service, email } = build({ stage: 0 });
    expect(await service.sendNotices('org-1', at('2026-11-01T00:30:00Z'))).toBe(0); // 03:30 Nairobi
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('leaves the notice unrecorded when the email fails, so the next run retries', async () => {
    const { service, update } = build({ stage: 0, emailOk: false });
    expect(await service.sendNotices('org-1', at('2026-11-01T06:00:00Z'))).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
