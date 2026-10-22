import { BadRequestException, Injectable } from '@nestjs/common';
import {
  HotelFolioEntry,
  RoomBooking,
  RoomBookingStatus,
} from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { folioTotals } from './folio.util';
import { maskId } from './guest-format';
import { kenyaClock } from './night-audit.util';
import { parseDay } from './room-availability.util';
import {
  bookingNightFigures,
  daysInRange,
  periodMetrics,
  toCsv,
} from './report.util';
import { readBreakdown } from './stay-pricing';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => Math.round(n * 100) / 100;
const MAX_DAYS = 366;
const MAX_ROWS = 5000;

export const REPORT_NAMES = [
  'occupancy',
  'revenue',
  'arrivals',
  'departures',
  'in-house',
  'balances',
  'cancellations',
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export interface Report {
  name: ReportName;
  title: string;
  from: string;
  to: string;
  columns: string[];
  rows: (string | number | null)[][];
  /** The headline figures above the table. */
  figures: { label: string; value: string | number }[];
}

type WithFolio = RoomBooking & { folio: { entries: HotelFolioEntry[] } | null };

const SOURCE_LABEL: Record<string, string> = {
  MARKETPLACE: 'Marketplace',
  FRONT_DESK: 'Front desk',
  PHONE: 'Phone',
};

/** The back-office reports: how full the hotel was, what it earned, who is coming, going and owing. */
@Injectable()
export class HotelReportsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async build(
    name: ReportName,
    fromInput?: string,
    toInput?: string,
    dateInput?: string,
  ): Promise<Report> {
    const today = kenyaClock(new Date()).date;
    const date = dateInput ?? today;
    const from = fromInput ?? date;
    const to = toInput ?? date;
    if (!parseDay(from) || !parseDay(to) || !parseDay(date))
      throw new BadRequestException('Choose real dates');
    if (to < from)
      throw new BadRequestException('The end date is before the start date');
    if (daysInRange(from, to).length > MAX_DAYS)
      throw new BadRequestException(
        `A report can cover up to ${MAX_DAYS} days`,
      );
    return this.tenantPrisma.run(async (tx) => {
      switch (name) {
        case 'occupancy':
        case 'revenue':
          return this.stayFigures(tx, name, from, to);
        case 'arrivals':
          return this.list(tx, name, 'Arrivals', date, {
            checkIn: parseDay(date)!,
            status: {
              in: [
                RoomBookingStatus.CONFIRMED,
                RoomBookingStatus.CHECKED_IN,
                RoomBookingStatus.CHECKED_OUT,
              ],
            },
          });
        case 'departures':
          return this.list(tx, name, 'Departures', date, {
            checkOut: parseDay(date)!,
            status: {
              in: [RoomBookingStatus.CHECKED_IN, RoomBookingStatus.CHECKED_OUT],
            },
          });
        case 'in-house':
          return this.list(tx, name, 'In house', date, {
            status: RoomBookingStatus.CHECKED_IN,
          });
        case 'balances':
          return this.balances(tx, to);
        case 'cancellations':
          return this.cancellations(tx, from, to);
        default:
          throw new BadRequestException('Unknown report');
      }
    });
  }

  csv(report: Report): string {
    return toCsv(report.columns, report.rows);
  }

  // ── Occupancy, ADR, RevPAR and revenue by source ───────────────────────

  private async roomCount(tx: TenantTx): Promise<number> {
    const [rooms, types] = await Promise.all([
      tx.hotelRoom.count({ where: { isActive: true } }),
      tx.hotelRoomType.aggregate({
        where: { isActive: true },
        _sum: { quantity: true },
      }),
    ]);
    return rooms > 0 ? rooms : (types._sum.quantity ?? 0);
  }

  private async stayFigures(
    tx: TenantTx,
    name: 'occupancy' | 'revenue',
    from: string,
    to: string,
  ): Promise<Report> {
    const bookings = await tx.roomBooking.findMany({
      where: {
        checkIn: { lte: parseDay(to)! },
        checkOut: { gt: parseDay(from)! },
        status: {
          in: [
            RoomBookingStatus.CONFIRMED,
            RoomBookingStatus.CHECKED_IN,
            RoomBookingStatus.CHECKED_OUT,
          ],
        },
      },
      take: MAX_ROWS,
    });
    const days = daysInRange(from, to);
    const perDay = new Map(days.map((d) => [d, { rooms: 0, revenue: 0 }]));
    const bySource = new Map<string, { nights: number; revenue: number }>();
    for (const b of bookings) {
      const nights = readBreakdown(b.priceBreakdown)?.nights ?? null;
      for (const n of bookingNightFigures(
        {
          checkIn: iso(b.checkIn),
          checkOut: iso(b.checkOut),
          rooms: b.rooms,
          pricePerNight: Number(b.pricePerNight),
          nights,
        },
        from,
        to,
      )) {
        const day = perDay.get(n.date)!;
        day.rooms += n.rooms;
        day.revenue = money(day.revenue + n.revenue);
        const src = bySource.get(b.source) ?? { nights: 0, revenue: 0 };
        src.nights += n.rooms;
        src.revenue = money(src.revenue + n.revenue);
        bySource.set(b.source, src);
      }
    }
    const rooms = await this.roomCount(tx);
    const sold = [...perDay.values()].reduce((s, d) => s + d.rooms, 0);
    const revenue = money(
      [...perDay.values()].reduce((s, d) => s + d.revenue, 0),
    );
    const m = periodMetrics({
      rooms,
      days: days.length,
      roomNightsSold: sold,
      roomRevenue: revenue,
    });
    const figures = [
      { label: 'Rooms', value: rooms },
      { label: 'Room nights sold', value: sold },
      { label: 'Occupancy %', value: m.occupancyPercent },
      { label: 'ADR (KES)', value: m.adr },
      { label: 'RevPAR (KES)', value: m.revpar },
      { label: 'Room revenue before tax (KES)', value: revenue },
    ];
    if (name === 'occupancy') {
      return {
        name,
        title: 'Occupancy',
        from,
        to,
        figures,
        columns: [
          'Date',
          'Rooms sold',
          'Rooms available',
          'Occupancy %',
          'Room revenue (KES)',
        ],
        rows: days.map((d) => {
          const day = perDay.get(d)!;
          return [
            d,
            day.rooms,
            rooms,
            rooms === 0 ? 0 : money((Math.min(day.rooms, rooms) / rooms) * 100),
            day.revenue,
          ];
        }),
      };
    }
    const sources = ['MARKETPLACE', 'FRONT_DESK', 'PHONE'];
    return {
      name,
      title: 'Revenue by source',
      from,
      to,
      figures,
      columns: [
        'Source',
        'Room nights',
        'Room revenue (KES)',
        'Share %',
        'ADR (KES)',
      ],
      rows: sources.map((s) => {
        const v = bySource.get(s) ?? { nights: 0, revenue: 0 };
        return [
          SOURCE_LABEL[s],
          v.nights,
          v.revenue,
          revenue === 0 ? 0 : money((v.revenue / revenue) * 100),
          v.nights === 0 ? 0 : money(v.revenue / v.nights),
        ];
      }),
    };
  }

  // ── Arrivals, departures, in house ─────────────────────────────────────

  private paidOf(b: WithFolio) {
    const t = b.folio
      ? folioTotals(
          b.folio.entries.map((e) => ({
            type: e.type,
            amount: Number(e.amount),
            taxAmount: Number(e.taxAmount),
          })),
        )
      : null;
    return {
      paid: t ? money(t.payments - t.refunds) : b.paidAt ? b.depositAmount : 0,
      balance: t ? t.balance : null,
    };
  }

  private async list(
    tx: TenantTx,
    name: 'arrivals' | 'departures' | 'in-house',
    title: string,
    date: string,
    where: object,
  ): Promise<Report> {
    const rows = await tx.roomBooking.findMany({
      where,
      include: {
        folio: { include: { entries: true } },
        assignments: {
          where: { toAt: null },
          include: { room: { select: { number: true } } },
        },
      },
      orderBy: [{ checkIn: 'asc' }, { createdAt: 'asc' }],
      take: MAX_ROWS,
    });
    return {
      name,
      title,
      from: date,
      to: date,
      figures: [
        { label: 'Bookings', value: rows.length },
        { label: 'Rooms', value: rows.reduce((s, b) => s + b.rooms, 0) },
        { label: 'Guests', value: rows.reduce((s, b) => s + b.guests, 0) },
      ],
      columns: [
        'Booking',
        'Guest',
        'Phone',
        'ID',
        'Room type',
        'Rooms',
        'Room numbers',
        'Check-in',
        'Check-out',
        'Nights',
        'Status',
        'Source',
        'Total (KES)',
        'Paid (KES)',
        'Balance (KES)',
      ],
      rows: rows.map((b) => {
        const { paid, balance } = this.paidOf(b as WithFolio);
        return [
          b.bookingNumber,
          b.guestName,
          b.guestPhone,
          maskId(b.idNumber),
          b.roomTypeName,
          b.rooms,
          b.assignments.map((a) => a.room.number).join(' '),
          iso(b.checkIn),
          iso(b.checkOut),
          b.nights,
          b.status,
          SOURCE_LABEL[b.source] ?? b.source,
          Number(b.total),
          paid,
          balance ?? money(Number(b.total) - paid),
        ];
      }),
    };
  }

  // ── What guests owe ────────────────────────────────────────────────────

  private async balances(tx: TenantTx, asOf: string): Promise<Report> {
    const bookings = await tx.roomBooking.findMany({
      where: {
        folio: { isNot: null },
        status: {
          in: [RoomBookingStatus.CHECKED_IN, RoomBookingStatus.CHECKED_OUT],
        },
      },
      include: { folio: { include: { entries: true } } },
      orderBy: { checkOut: 'asc' },
      take: MAX_ROWS,
    });
    const owing = bookings
      .map((b) => ({ b, ...this.paidOf(b as WithFolio) }))
      .filter((x) => (x.balance ?? 0) > 0.004);
    return {
      name: 'balances',
      title: 'Outstanding balances',
      from: asOf,
      to: asOf,
      figures: [
        { label: 'Guests owing', value: owing.length },
        {
          label: 'Total owed (KES)',
          value: money(owing.reduce((s, x) => s + (x.balance ?? 0), 0)),
        },
      ],
      columns: [
        'Booking',
        'Guest',
        'Phone',
        'Status',
        'Check-out',
        'Balance (KES)',
        'Reason left owing',
      ],
      rows: owing.map((x) => [
        x.b.bookingNumber,
        x.b.guestName,
        x.b.guestPhone,
        x.b.status,
        iso(x.b.checkOut),
        x.balance,
        x.b.balanceLeftReason,
      ]),
    };
  }

  // ── Cancellations and no-shows ─────────────────────────────────────────

  private async cancellations(
    tx: TenantTx,
    from: string,
    to: string,
  ): Promise<Report> {
    const start = new Date(parseDay(from)!.getTime() - 3 * 3_600_000);
    const end = new Date(parseDay(to)!.getTime() + 21 * 3_600_000);
    const bookings = await tx.roomBooking.findMany({
      where: {
        status: {
          in: [RoomBookingStatus.CANCELLED, RoomBookingStatus.NO_SHOW],
        },
        cancelledAt: { gte: start, lt: end },
      },
      include: { folio: { include: { entries: true } } },
      orderBy: { cancelledAt: 'desc' },
      take: MAX_ROWS,
    });
    const rows = bookings.map((b) => {
      const { paid } = this.paidOf(b as WithFolio);
      const kept = Number(b.cancelFeeKept ?? 0);
      return { b, paid, kept, refundPending: money(Math.max(0, paid - kept)) };
    });
    return {
      name: 'cancellations',
      title: 'Cancellations and no-shows',
      from,
      to,
      figures: [
        {
          label: 'Cancelled',
          value: bookings.filter((b) => b.status === 'CANCELLED').length,
        },
        {
          label: 'No-shows',
          value: bookings.filter((b) => b.status === 'NO_SHOW').length,
        },
        {
          label: 'Fees kept (KES)',
          value: money(rows.reduce((s, r) => s + r.kept, 0)),
        },
        {
          label: 'Refunds still to pay (KES)',
          value: money(rows.reduce((s, r) => s + r.refundPending, 0)),
        },
      ],
      columns: [
        'Booking',
        'Guest',
        'Status',
        'Cancelled on',
        'Arrival',
        'Room type',
        'Reason',
        'Paid (KES)',
        'Fee kept (KES)',
        'Refund still to pay (KES)',
      ],
      rows: rows.map((r) => [
        r.b.bookingNumber,
        r.b.guestName,
        r.b.status,
        r.b.cancelledAt ? r.b.cancelledAt.toISOString().slice(0, 10) : null,
        iso(r.b.checkIn),
        r.b.roomTypeName,
        r.b.cancelReason,
        r.paid,
        r.kept,
        r.refundPending,
      ]),
    };
  }
}
