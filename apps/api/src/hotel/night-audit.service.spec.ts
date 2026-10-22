import { BadRequestException } from '@nestjs/common';
import { NightAuditService } from './night-audit.service';

// A tiny stand-in for the database transaction, recording what the audit tries to write.
function fakeTx(over: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    hotelNightAudit: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(async () => (writes.push('audit.create'), {})),
    },
    hotelSetting: { findFirst: jest.fn().mockResolvedValue(null) },
    roomBooking: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest
        .fn()
        .mockImplementation(async () => (writes.push('booking.update'), {})),
      updateMany: jest
        .fn()
        .mockImplementation(
          async () => (writes.push('booking.updateMany'), { count: 1 }),
        ),
    },
    hotelRoom: { count: jest.fn().mockResolvedValue(10) },
    hotelRoomType: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 10 } }),
    },
    hotelFolioEntry: { findMany: jest.fn().mockResolvedValue([]) },
    hotelRoomAssignment: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: jest
        .fn()
        .mockImplementation(async () => (writes.push('auditLog.create'), {})),
    },
    ...over,
  };
  return { tx: tx as never, writes, raw: tx };
}

const service = () => new NightAuditService({} as never, {} as never);
const ORG = 'org-1';
const NOW = new Date('2026-11-05T09:00:00Z'); // 12:00 on 5 Nov in Kenya

describe('NightAuditService.closeDay', () => {
  it('writes the audit once and returns a summary', async () => {
    const { tx, writes } = fakeTx();
    const r = await service().closeDay(tx, ORG, '2026-11-04', 'u1', NOW);
    expect(r.alreadyRun).toBe(false);
    expect(r.summary.date).toBe('2026-11-04');
    expect(r.summary.rooms.total).toBe(10);
    expect(writes.filter((w) => w === 'audit.create')).toHaveLength(1);
  });

  it('a day that was already closed is returned as it was, and nothing is written', async () => {
    const saved = {
      summary: { date: '2026-11-04', overstays: [], arrivals: { noShows: [] } },
    };
    const { tx, writes, raw } = fakeTx({
      hotelNightAudit: {
        findUnique: jest.fn().mockResolvedValue(saved),
        create: jest.fn(),
      },
    });
    const r = await service().closeDay(tx, ORG, '2026-11-04', 'u2', NOW);
    expect(r.alreadyRun).toBe(true);
    expect(r.summary).toBe(saved.summary);
    expect(writes).toEqual([]);
    expect(
      (raw as { roomBooking: { findMany: jest.Mock } }).roomBooking.findMany,
    ).not.toHaveBeenCalled();
  });

  it('takes the per-business lock before looking, so two runs at once cannot both do the work', async () => {
    const { tx, raw } = fakeTx();
    await service().closeDay(tx, ORG, '2026-11-04', 'u1', NOW);
    const order = [
      (raw as { $executeRaw: jest.Mock }).$executeRaw.mock
        .invocationCallOrder[0],
      (raw as { hotelNightAudit: { findUnique: jest.Mock } }).hotelNightAudit
        .findUnique.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it("two runs that both get past the check: the second finds the first one's row and returns it", async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const dup = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const theirs = { summary: { date: '2026-11-04' } };
    const findUnique = jest.fn().mockResolvedValueOnce(null);
    const { tx } = fakeTx({
      hotelNightAudit: {
        findUnique,
        findUniqueOrThrow: jest.fn().mockResolvedValue(theirs),
        create: jest.fn().mockRejectedValue(dup),
      },
    });
    const r = await service().closeDay(tx, ORG, '2026-11-04', 'u1', NOW);
    expect(r.alreadyRun).toBe(true);
    expect(r.summary).toBe(theirs.summary);
  });

  it('refuses a day that has not happened yet, and today before the cut-off hour', async () => {
    await expect(
      service().closeDay(fakeTx().tx, ORG, '2026-11-06', 'u1', NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service().closeDay(fakeTx().tx, ORG, '2026-11-05', 'u1', NOW),
    ).rejects.toThrow(/from 18:00/);
  });

  it('marks an unpaid arrival that never came as a no-show, and leaves one that paid', async () => {
    const day = new Date('2026-11-04T00:00:00Z');
    const mk = (id: string, paidAt: Date | null, deposit: number) => ({
      id,
      bookingNumber: id,
      guestName: id,
      status: 'CONFIRMED',
      checkIn: day,
      checkOut: new Date('2026-11-06T00:00:00Z'),
      folio: null,
      paidAt,
      depositAmount: deposit,
    });
    const findMany = jest
      .fn()
      .mockImplementation(async (args: { where: { status?: unknown } }) =>
        args.where.status === 'CHECKED_IN'
          ? []
          : (args.where as { checkIn?: unknown }).checkIn
            ? [mk('unpaid', null, 0), mk('paid', new Date(), 1000)]
            : [],
      );
    const { tx, writes } = fakeTx({
      roomBooking: {
        findMany,
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        updateMany: jest
          .fn()
          .mockImplementation(
            async () => (writes.push('noshow'), { count: 1 }),
          ),
      },
    });
    const r = await service().closeDay(tx, ORG, '2026-11-04', 'u1', NOW);
    expect(r.summary.arrivals.noShows.map((n) => n.bookingNumber)).toEqual([
      'unpaid',
    ]);
    expect(
      r.summary.arrivals.stillExpectedPaid.map((n) => n.bookingNumber),
    ).toEqual(['paid']);
    expect(writes.filter((w) => w === 'noshow')).toHaveLength(1);
  });

  it('the automatic run (nobody pressed the button) logs without an actor', async () => {
    const { tx, raw } = fakeTx();
    await service().closeDay(tx, ORG, '2026-11-04', 'auto', NOW);
    expect(
      (
        raw as { auditLog: { create: jest.Mock } }
      ).auditLog.create.mock.calls.every((c) => c[0].data.actorId === null),
    ).toBe(true);
  });
});
