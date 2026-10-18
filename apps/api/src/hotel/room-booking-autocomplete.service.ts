import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RoomBookingStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { roundMoney } from '../online-orders/online-orders.util';
import { autoCompleteCutoff, checkedOutAtFor } from './room-availability.util';

const FIRST_RUN_DELAY_MS = 3 * 60_000;
const INTERVAL_MS = 60 * 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 };

/**
 * Completes stays that were never checked out. A booking whose guest paid the deposit and whose check-out date is well
 * past (see autoCompleteCutoff - a short grace period leaves the hotel time to mark a no-show or cancel) is marked
 * checked out by itself, with its commission recorded exactly as if the hotel had pressed Check out. Without this a hotel
 * could avoid commission just by never checking guests out.
 *
 * Runs inside the API process on a timer, like commission billing, with an advisory lock so several instances never
 * do it twice, and it is idempotent (only bookings still CONFIRMED / CHECKED_IN are touched).
 * HOTEL_SCHEDULER=off turns the timer off.
 */
@Injectable()
export class RoomBookingAutoCompleteService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomBookingAutoCompleteService.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('HOTEL_SCHEDULER') === 'off' || process.env.NODE_ENV === 'test') {
      this.logger.log('Hotel stay auto-completion is off');
      return;
    }
    this.firstRun = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    this.firstRun.unref();
    this.interval = setInterval(() => void this.tick(), INTERVAL_MS);
    this.interval.unref();
  }

  onModuleDestroy() {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.interval) clearInterval(this.interval);
  }

  /** One timed pass: takes the lock, completes what is overdue, never throws. */
  async tick(now: Date = new Date()) {
    try {
      const completed = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('zaroda-hotel-auto-complete')) AS locked`;
          if (!rows[0]?.locked) return 0; // another instance is already on it
          return this.completeOverdue(now);
        },
        { timeout: RUN_TIMEOUT_MS, maxWait: 15_000 },
      );
      if (completed > 0) this.logger.log({ completed }, 'Completed stays that were never checked out');
    } catch (e) {
      this.logger.error({ err: e }, 'Completing overdue stays failed');
    }
  }

  /** Every hotel's overdue stays. Returns how many bookings were completed. Also what a platform admin's "run now" calls. */
  async completeOverdue(now: Date = new Date()): Promise<number> {
    const cutoff = autoCompleteCutoff(now);
    // Every business: bookings sit behind row-level security, so there is no way to ask "which businesses have bookings"
    // across tenants. The same hourly pattern as commission invoicing; each business is one cheap query.
    const organizations = await this.prisma.organization.findMany({ select: { id: true } });
    let completed = 0;
    for (const org of organizations) {
      completed += await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${org.id}, true)`;
        const overdue = await tx.roomBooking.findMany({
          where: { status: { in: [RoomBookingStatus.CONFIRMED, RoomBookingStatus.CHECKED_IN] }, paidAt: { not: null }, checkOut: { lte: cutoff } },
          select: { id: true, total: true, commissionRate: true, checkOut: true },
        });
        let done = 0;
        for (const booking of overdue) {
          const result = await tx.roomBooking.updateMany({
            // Still unfinished: a hotel pressing Check out at the same moment wins, and this does nothing.
            where: { id: booking.id, status: { in: [RoomBookingStatus.CONFIRMED, RoomBookingStatus.CHECKED_IN] } },
            data: {
              status: RoomBookingStatus.CHECKED_OUT,
              checkedOutAt: checkedOutAtFor(booking.checkOut),
              commissionAmount: roundMoney(Number(booking.total) * Number(booking.commissionRate)),
            } satisfies Prisma.RoomBookingUncheckedUpdateManyInput,
          });
          done += result.count;
        }
        return done;
      }, TX_OPTIONS);
    }
    return completed;
  }
}
