import { Prisma } from '@prisma/client';
import { HotelNotifierService } from './hotel-notifier.service';

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  guestName: 'Wanjiru Kamau',
  guestPhone: '254711222333',
  guestEmail: null,
  hotelName: 'Sea View',
  bookingNumber: 'ZB-ABC123',
  roomTypeName: 'Deluxe',
  rooms: 1,
  checkIn: new Date('2026-11-05T00:00:00Z'),
  checkOut: new Date('2026-11-07T00:00:00Z'),
  total: 10000,
  paidAt: null,
  depositAmount: 0,
  smsOptOut: false,
  guest: { smsOptOut: false },
  folio: { entries: [{ type: 'PAYMENT', amount: 2000 }] },
  ...over,
});

function setup(
  opts: {
    booking?: Record<string, unknown>;
    rules?: Record<string, unknown> | null;
    claim?: 'ok' | 'dup';
    smsSent?: boolean;
    email?: boolean;
  } = {},
) {
  const claims: { status: string; detail: string | null }[] = [];
  const updates: { status: string; detail: string }[] = [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    roomBooking: {
      findUnique: jest.fn().mockResolvedValue(booking(opts.booking)),
    },
    hotelSetting: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.rules === undefined ? null : opts.rules),
    },
    hotelNotification: {
      create: jest
        .fn()
        .mockImplementation(
          async ({
            data,
          }: {
            data: { status: string; detail: string | null };
          }) => {
            if (opts.claim === 'dup')
              throw new Prisma.PrismaClientKnownRequestError('dup', {
                code: 'P2002',
                clientVersion: 'test',
              });
            claims.push({ status: data.status, detail: data.detail });
            return {};
          },
        ),
      updateMany: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: { status: string; detail: string } }) => (
            updates.push(data),
            { count: 1 }
          ),
        ),
    },
  };
  const prisma = {
    $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  };
  const sms = {
    sendSms: jest.fn().mockResolvedValue({ sent: opts.smsSent ?? true }),
  };
  const email = {
    sendEmail: jest.fn().mockResolvedValue({ sent: opts.email ?? true }),
  };
  const service = new HotelNotifierService(
    prisma as never,
    sms as never,
    email as never,
  );
  return { service, sms, email, claims, updates };
}

describe('HotelNotifierService', () => {
  it('sends a text and records it as sent', async () => {
    const { service, sms, updates } = setup();
    expect(await service.send('org', 'b1', 'CONFIRMATION')).toBe('SENT');
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
    expect(sms.sendSms.mock.calls[0][0].to).toBe('+254711222333');
    expect(sms.sendSms.mock.calls[0][0].message).toContain('ZB-ABC123');
    expect(updates[0].status).toBe('SENT');
  });

  it('a message already sent for this booking and kind is not sent again', async () => {
    const { service, sms } = setup({ claim: 'dup' });
    expect(await service.send('org', 'b1', 'REMINDER')).toBe('ALREADY_DONE');
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('a guest who opted out is never texted, and it is recorded as skipped', async () => {
    const { service, sms, claims } = setup({ booking: { smsOptOut: true } });
    expect(await service.send('org', 'b1', 'CONFIRMATION')).toBe('SKIPPED');
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(claims[0]).toEqual({ status: 'SKIPPED', detail: 'Guest opted out' });
  });

  it("the opt-out on the guest's register entry counts too", async () => {
    const { service, sms } = setup({ booking: { guest: { smsOptOut: true } } });
    expect(await service.send('org', 'b1', 'THANK_YOU')).toBe('SKIPPED');
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('a text the hotel switched off is skipped', async () => {
    const { service, sms, claims } = setup({
      rules: {
        cancelFreeDays: 2,
        cancelKeepPercent: 0,
        nightAuditHour: 3,
        noShowCutoffHour: 18,
        confirmationSms: true,
        reminderSms: false,
        thankYouSms: true,
      },
    });
    expect(await service.send('org', 'b1', 'REMINDER')).toBe('SKIPPED');
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(claims[0].detail).toBe('Switched off by the hotel');
  });

  it('falls back to email when the text cannot be delivered and the guest gave an address', async () => {
    const { service, sms, email, updates } = setup({
      smsSent: false,
      booking: { guestEmail: 'wanjiru@example.com' },
    });
    expect(await service.send('org', 'b1', 'CONFIRMATION')).toBe('SENT');
    expect(sms.sendSms).toHaveBeenCalled();
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'wanjiru@example.com' }),
    );
    expect(updates[0].detail).toBe('email');
  });

  it('a text that cannot be delivered and no email is recorded as failed, not thrown', async () => {
    const { service, updates } = setup({ smsSent: false });
    expect(await service.send('org', 'b1', 'CONFIRMATION')).toBe('FAILED');
    expect(updates[0].status).toBe('FAILED');
  });

  it('never throws into the action that triggered it', async () => {
    const { service, sms } = setup();
    sms.sendSms.mockRejectedValueOnce(new Error('network down'));
    await expect(service.send('org', 'b1', 'CONFIRMATION')).resolves.toBe(
      'FAILED',
    );
  });

  it('a cancellation text carries the fee and the refund', async () => {
    const { service, sms } = setup();
    await service.send('org', 'b1', 'CANCELLATION', {
      feeKept: 1000,
      refundDue: 1000,
    });
    expect(sms.sendSms.mock.calls[0][0].message).toContain('keeps KES 1,000');
  });
});
