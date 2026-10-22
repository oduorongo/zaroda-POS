import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, RoomBookingStatus } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { HotelFolioService } from './hotel-folio.service';
import { loadRules } from './hotel-settings.service';
import {
  auditClosable,
  dayAfter,
  isNoShow,
  kenyaClock,
  overstayNights,
} from './night-audit.util';
import { nightsBetween, parseDay } from './room-availability.util';
import {
  breakdownOf,
  legacyNights,
  readBreakdown,
  restitch,
} from './stay-pricing';
import { nightDates } from './pricing.util';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => Math.round(n * 100) / 100;
const KENYA_MS = 3 * 3_600_000;

export interface NightAuditSummary {
  date: string;
  ranBy: string;
  rooms: { total: number; occupied: number; occupancyPercent: number };
  arrivals: {
    expected: number;
    arrived: number;
    noShows: { bookingNumber: string; guestName: string }[];
    stillExpectedPaid: {
      bookingNumber: string;
      guestName: string;
      paid: number;
    }[];
  };
  departures: { due: number; left: number };
  overstays: {
    bookingNumber: string;
    guestName: string;
    nights: number;
    charged: number;
  }[];
  money: {
    roomRevenue: number;
    roomTax: number;
    paymentsReceived: number;
    refundsGiven: number;
    outstandingInHouse: number;
  };
}

/**
 * The close of a hotel day. It charges guests who stayed past their check-out date for the extra nights, marks arrivals that never
 * came and paid nothing as no-shows, and writes a one-page summary. One audit per business per day: running it twice finds the first
 * and changes nothing (a per-business lock makes two runs at once safe too).
 */
@Injectable()
export class NightAuditService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly folios: HotelFolioService,
  ) {}

  /** The audit button. `date` defaults to today. */
  async run(dateInput?: string) {
    const { organizationId, orgUserId } = getTenantStore();
    const date = dateInput ?? kenyaClock(new Date()).date;
    if (!parseDay(date)) throw new BadRequestException('Choose a real date');
    return this.tenantPrisma.run((tx) =>
      this.closeDay(tx, organizationId, date, orgUserId, new Date()),
    );
  }

  /** The audit-log line for something the audit did: by the person who pressed the button, or by nobody when the timer ran it. */
  private log(
    tx: TenantTx,
    organizationId: string,
    ranBy: string,
    entry: {
      action: string;
      entityType: string;
      entityId: string;
      after?: unknown;
    },
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        actorId: ranBy === 'auto' ? null : ranBy,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        after: entry.after as object,
      },
    });
  }

  async list(limit = 31) {
    return this.tenantPrisma.run(async (tx) =>
      (
        await tx.hotelNightAudit.findMany({
          orderBy: { auditDate: 'desc' },
          take: Math.min(limit, 100),
        })
      ).map((a) => ({
        id: a.id,
        date: iso(a.auditDate),
        ranBy: a.ranBy,
        createdAt: a.createdAt,
        summary: a.summary as unknown as NightAuditSummary,
      })),
    );
  }

  /** Closes `date` inside a transaction that is already set to the business. Safe to call again for the same day. */
  async closeDay(
    tx: TenantTx,
    organizationId: string,
    date: string,
    ranBy: string,
    now: Date,
  ): Promise<{ alreadyRun: boolean; summary: NightAuditSummary }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'hotel-night-audit:' + organizationId}))`;
    const existing = await tx.hotelNightAudit.findUnique({
      where: {
        organizationId_auditDate: {
          organizationId,
          auditDate: parseDay(date)!,
        },
      },
    });
    if (existing)
      return {
        alreadyRun: true,
        summary: existing.summary as unknown as NightAuditSummary,
      };

    const rules = await loadRules(tx);
    const closable = auditClosable(date, now, rules.noShowCutoffHour);
    if ('reason' in closable) throw new BadRequestException(closable.reason);

    const day = parseDay(date)!;
    const next = parseDay(dayAfter(date))!;

    // 1. Guests still in the house past their check-out date owe the extra nights.
    const overstayers = await tx.roomBooking.findMany({
      where: { status: RoomBookingStatus.CHECKED_IN, checkOut: { lte: day } },
    });
    const overstays: NightAuditSummary['overstays'] = [];
    for (const b of overstayers) {
      const extra = overstayNights(iso(b.checkOut), date);
      if (extra.length === 0) continue;
      const stored = readBreakdown(b.priceBreakdown);
      const nights =
        stored?.nights ??
        legacyNights(b, nightDates(iso(b.checkIn), iso(b.checkOut)));
      const last = nights[nights.length - 1];
      const priced = restitch(
        [...nights, ...extra.map((d) => ({ ...last, date: d }))],
        b.rooms,
      );
      const before = Number(b.total);
      await tx.roomBooking.update({
        where: { id: b.id },
        data: {
          checkOut: next,
          nights: nightsBetween(b.checkIn, next),
          total: priced.total,
          pricePerNight: priced.averageRate,
          priceBreakdown: breakdownOf(
            priced,
            stored?.flatRate ?? null,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      const fresh = await this.folios.loadBooking(tx, b.id);
      const folio = await this.folios.ensureFolio(tx, fresh);
      await this.folios.syncRoomNights(
        tx,
        fresh,
        folio,
        ranBy,
        `Stayed past check-out (night audit ${date})`,
      );
      await this.log(tx, organizationId, ranBy, {
        action: 'hotel.overstay_charged',
        entityType: 'RoomBooking',
        entityId: b.id,
        after: { nights: extra, total: priced.total },
      });
      overstays.push({
        bookingNumber: b.bookingNumber,
        guestName: b.guestName,
        nights: extra.length,
        charged: money(priced.total - before),
      });
    }

    // 2. Arrivals that never came and paid nothing become no-shows; ones that paid are left for the manager to decide.
    const arrivals = await tx.roomBooking.findMany({
      where: {
        checkIn: { lte: day },
        checkOut: { gt: day },
        status: {
          in: [RoomBookingStatus.CONFIRMED, RoomBookingStatus.CHECKED_IN],
        },
      },
      include: { folio: { include: { entries: true } } },
    });
    const noShows: NightAuditSummary['arrivals']['noShows'] = [];
    const stillExpectedPaid: NightAuditSummary['arrivals']['stillExpectedPaid'] =
      [];
    for (const b of arrivals) {
      if (b.status !== RoomBookingStatus.CONFIRMED) continue;
      const totals = b.folio ? this.folios.summary(b.folio.entries) : null;
      const paid = totals
        ? money(totals.payments - totals.refunds)
        : b.paidAt
          ? b.depositAmount
          : 0;
      if (isNoShow({ status: b.status, checkIn: iso(b.checkIn), paid }, date)) {
        const moved = await tx.roomBooking.updateMany({
          where: { id: b.id, status: RoomBookingStatus.CONFIRMED },
          data: {
            status: RoomBookingStatus.NO_SHOW,
            cancelledAt: now,
            cancelReason: `No-show (night audit ${date})`,
            cancelFeeKept: 0,
            commissionAmount: 0,
          },
        });
        if (moved.count > 0) {
          await tx.hotelRoomAssignment.deleteMany({
            where: { bookingId: b.id, toAt: null },
          });
          await this.log(tx, organizationId, ranBy, {
            action: 'hotel.booking_no_show',
            entityType: 'RoomBooking',
            entityId: b.id,
            after: { reason: 'night audit', date },
          });
          noShows.push({
            bookingNumber: b.bookingNumber,
            guestName: b.guestName,
          });
        }
      } else {
        stillExpectedPaid.push({
          bookingNumber: b.bookingNumber,
          guestName: b.guestName,
          paid,
        });
      }
    }

    // 3. The summary.
    const [roomCount, typeSum] = await Promise.all([
      tx.hotelRoom.count({ where: { isActive: true } }),
      tx.hotelRoomType.aggregate({
        where: { isActive: true },
        _sum: { quantity: true },
      }),
    ]);
    const totalRooms = roomCount > 0 ? roomCount : (typeSum._sum.quantity ?? 0);
    const inHouse = await tx.roomBooking.findMany({
      where: { status: RoomBookingStatus.CHECKED_IN },
      include: { folio: { include: { entries: true } } },
    });
    const occupied = inHouse
      .filter((b) => b.checkIn <= day)
      .reduce((s, b) => s + b.rooms, 0);
    const dayStart = new Date(day.getTime() - KENYA_MS);
    const dayEnd = new Date(next.getTime() - KENYA_MS);
    const [nightEntries, paymentEntries, expectedArrivals, arrived, due, left] =
      await Promise.all([
        tx.hotelFolioEntry.findMany({
          where: { type: 'ROOM_NIGHT', nightDate: day },
          select: { amount: true, taxAmount: true },
        }),
        tx.hotelFolioEntry.findMany({
          where: {
            type: { in: ['PAYMENT', 'REFUND'] },
            createdAt: { gte: dayStart, lt: dayEnd },
          },
          select: { type: true, amount: true },
        }),
        tx.roomBooking.count({
          where: {
            checkIn: day,
            status: {
              in: [
                RoomBookingStatus.CONFIRMED,
                RoomBookingStatus.CHECKED_IN,
                RoomBookingStatus.CHECKED_OUT,
                RoomBookingStatus.NO_SHOW,
              ],
            },
          },
        }),
        tx.roomBooking.count({
          where: { checkIn: day, checkedInAt: { not: null } },
        }),
        tx.roomBooking.count({
          where: {
            checkOut: day,
            status: {
              in: [RoomBookingStatus.CHECKED_IN, RoomBookingStatus.CHECKED_OUT],
            },
          },
        }),
        tx.roomBooking.count({
          where: { checkOut: day, status: RoomBookingStatus.CHECKED_OUT },
        }),
      ]);
    const sum = (rows: { amount: Prisma.Decimal }[]) =>
      rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0) / 100;
    const gross = sum(nightEntries);
    const tax = money(
      nightEntries.reduce(
        (s, r) => s + Math.round(Number(r.taxAmount) * 100),
        0,
      ) / 100,
    );
    const outstanding = inHouse.reduce(
      (s, b) =>
        s + (b.folio ? this.folios.summary(b.folio.entries).balance : 0),
      0,
    );
    const summary: NightAuditSummary = {
      date,
      ranBy,
      rooms: {
        total: totalRooms,
        occupied,
        occupancyPercent:
          totalRooms === 0
            ? 0
            : money((Math.min(occupied, totalRooms) / totalRooms) * 100),
      },
      arrivals: {
        expected: expectedArrivals,
        arrived,
        noShows,
        stillExpectedPaid,
      },
      departures: { due, left },
      overstays,
      money: {
        roomRevenue: money(gross - tax),
        roomTax: tax,
        paymentsReceived: sum(
          paymentEntries.filter((p) => p.type === 'PAYMENT'),
        ),
        refundsGiven: sum(paymentEntries.filter((p) => p.type === 'REFUND')),
        outstandingInHouse: money(outstanding),
      },
    };
    try {
      await tx.hotelNightAudit.create({
        data: {
          organizationId,
          auditDate: day,
          ranBy,
          summary: summary as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      // another run got in first (the lock makes this very unlikely): hand back theirs
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const theirs = await tx.hotelNightAudit.findUniqueOrThrow({
          where: {
            organizationId_auditDate: { organizationId, auditDate: day },
          },
        });
        return {
          alreadyRun: true,
          summary: theirs.summary as unknown as NightAuditSummary,
        };
      }
      throw e;
    }
    await this.log(tx, organizationId, ranBy, {
      action: 'hotel.night_audit',
      entityType: 'HotelNightAudit',
      entityId: date,
      after: { ranBy, overstays: overstays.length, noShows: noShows.length },
    });
    return { alreadyRun: false, summary };
  }
}
