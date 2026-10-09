import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { CommissionService } from './commission.service';

// First run shortly after boot (so a restart after downtime catches up),
// then once an hour. Every step it runs is idempotent, so this is cheap
// when there is nothing to do.
const FIRST_RUN_DELAY_MS = 2 * 60_000;
const INTERVAL_MS = 60 * 60_000;
// Emails only go out in Nairobi's daytime - nobody wants an invoice at 3am.
const EMAIL_FROM_HOUR = 6;
const EMAIL_UNTIL_HOUR = 20;
const RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * The automatic part of commission billing: creates invoices when a month
 * ends, emails them and the reminders, and confirms payments whose callback
 * never arrived (CommissionService.runAutomation).
 *
 * Runs inside the API process on a timer rather than as a separate worker,
 * so it needs nothing beyond the web service you already run. Two safety
 * measures make that fine:
 * - a Postgres advisory lock, so if the API ever runs on several instances
 *   only one does the work at a time and nobody gets a duplicate email;
 * - every step is idempotent (invoices are keyed per business and month,
 *   each reminder stage is recorded once), so an overlap or a crash
 *   half-way is simply picked up on the next run.
 *
 * Caveat: a timer only ticks while the process is awake. A host that puts
 * idle services to sleep (some free tiers) would pause it until the next
 * visit - the first-run-after-boot catch-up covers that, and
 * COMMISSION_SCHEDULER=off turns it off entirely.
 */
@Injectable()
export class CommissionSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommissionSchedulerService.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly commission: CommissionService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('COMMISSION_SCHEDULER') === 'off' || process.env.NODE_ENV === 'test') {
      this.logger.log('Commission scheduler is off');
      return;
    }
    // unref: a pending timer must never be the reason a process can't exit.
    this.firstRun = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    this.firstRun.unref();
    this.interval = setInterval(() => void this.tick(), INTERVAL_MS);
    this.interval.unref();
    this.logger.log('Commission scheduler on: invoices and reminders run automatically');
  }

  onModuleDestroy() {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.interval) clearInterval(this.interval);
  }

  /** Public so tests (and an operator's one-off script) can trigger one pass. */
  async tick(now: Date = new Date()) {
    // Nairobi is UTC+3 all year.
    const nairobiHour = (now.getUTCHours() + 3) % 24;
    const sendEmails = nairobiHour >= EMAIL_FROM_HOUR && nairobiHour < EMAIL_UNTIL_HOUR;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('zaroda-commission-automation')) AS locked`;
          if (!rows[0]?.locked) return null; // another instance is already on it
          return this.commission.runAutomation({ sendEmails });
        },
        { timeout: RUN_TIMEOUT_MS, maxWait: 15_000 },
      );
      if (result && (result.invoicesCreated || result.paymentsConfirmed || result.emailsSent)) {
        this.logger.log(result, 'Commission automation did work');
      }
    } catch (e) {
      // A failed pass must never take the API down; the next tick tries again.
      this.logger.error({ err: e }, 'Commission automation failed');
    }
  }
}
