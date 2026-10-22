import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomBookingStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { HotelNotifierService } from './hotel-notifier.service';
import { tomorrowOf } from './hotel-messages.util';
import { loadRules } from './hotel-settings.service';
import { autoAuditDate, kenyaClock } from './night-audit.util';
import { NightAuditService } from './night-audit.service';

const FIRST_RUN_DELAY_MS = 4 * 60_000;
const INTERVAL_MS = 15 * 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
/** Reminders go out in the morning, not at 3am. */
const REMINDER_HOUR = 9;
/** A thank-you is only sent for a stay that ended within this long. */
const THANK_YOU_WINDOW_MS = 36 * 3_600_000;

/**
 * The hotel's timed jobs, in the API process like the stay auto-completion (with an advisory lock so several instances never do
 * the same pass, and every job idempotent): each business's night audit at its chosen hour, the day-before-arrival reminders and the
 * thank-yous after check-out. HOTEL_SCHEDULER=off turns the timer off.
 */
@Injectable()
export class HotelSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HotelSchedulerService.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audits: NightAuditService,
    private readonly notifier: HotelNotifierService,
  ) {}

  onModuleInit() {
    if (
      this.config.get<string>('HOTEL_SCHEDULER') === 'off' ||
      process.env.NODE_ENV === 'test'
    ) {
      this.logger.log('Hotel night audit and guest messages are off');
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

  /** One timed pass. Never throws. */
  async tick(now: Date = new Date()) {
    try {
      const locked = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtext('zaroda-hotel-scheduler')) AS locked`;
          if (!rows[0]?.locked) return false; // another instance is already on it
          await this.runAll(now);
          return true;
        },
        { timeout: RUN_TIMEOUT_MS, maxWait: 15_000 },
      );
      if (!locked)
        this.logger.debug('Another instance is running the hotel jobs');
    } catch (e) {
      this.logger.error({ err: e }, 'Hotel scheduled jobs failed');
    }
  }

  /** Every business with rooms. Also what a test or a platform admin can call directly. */
  async runAll(now: Date = new Date()) {
    const organizations = await this.prisma.organization.findMany({
      select: { id: true },
    });
    for (const org of organizations) {
      try {
        const work = await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_tenant', ${org.id}, true)`;
            const db = tx as unknown as TenantTx;
            if ((await db.hotelRoomType.count()) === 0) return null;
            const rules = await loadRules(db);
            // 1. the night audit for the day that has just ended
            const auditDate = autoAuditDate(now, rules.nightAuditHour);
            let audited = false;
            if (auditDate) {
              const r = await this.audits
                .closeDay(db, org.id, auditDate, 'auto', now)
                .catch((e: unknown) => {
                  this.logger.warn(
                    { err: e, organizationId: org.id },
                    'Automatic night audit failed',
                  );
                  return null;
                });
              audited = !!r && !r.alreadyRun;
            }
            // 2. who needs a reminder or a thank-you
            const clock = kenyaClock(now);
            const reminders =
              clock.hour >= REMINDER_HOUR
                ? await db.roomBooking.findMany({
                    where: {
                      status: RoomBookingStatus.CONFIRMED,
                      checkIn: new Date(`${tomorrowOf(clock.date)}T00:00:00Z`),
                    },
                    select: { id: true },
                  })
                : [];
            const thanks = await db.roomBooking.findMany({
              where: {
                status: RoomBookingStatus.CHECKED_OUT,
                checkedOutAt: {
                  gte: new Date(now.getTime() - THANK_YOU_WINDOW_MS),
                },
              },
              select: { id: true },
            });
            return {
              audited,
              reminders: reminders.map((b) => b.id),
              thanks: thanks.map((b) => b.id),
            };
          },
          { timeout: 60_000, maxWait: 15_000 },
        );
        if (!work) continue;
        if (work.audited)
          this.logger.log({ organizationId: org.id }, 'Night audit closed');
        // messages go out after the transaction, each at most once per booking and kind
        for (const id of work.reminders)
          await this.notifier.send(org.id, id, 'REMINDER');
        for (const id of work.thanks)
          await this.notifier.send(org.id, id, 'THANK_YOU');
      } catch (e) {
        this.logger.error(
          { err: e, organizationId: org.id },
          'Hotel jobs failed for a business',
        );
      }
    }
  }
}
