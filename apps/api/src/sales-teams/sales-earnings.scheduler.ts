import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { SalesEarningsService } from './sales-earnings.service';

// First run shortly after boot, then hourly - so what is earned is written down close to when Zaroda is paid,
// which is what pins the rate used (a later change of a team's terms only affects what is earned after it).
const FIRST_RUN_DELAY_MS = 3 * 60_000;
const INTERVAL_MS = 60 * 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * Keeps the teams' earnings ledger up to date in the background. Same shape as the commission scheduler: an in-process
 * timer, a Postgres advisory lock so several API instances never do the work at once, and an idempotent step (every
 * source is credited once), so an overlap or a crash half-way is simply picked up on the next run.
 * SALES_EARNINGS_SCHEDULER=off turns it off.
 */
@Injectable()
export class SalesEarningsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SalesEarningsScheduler.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly earnings: SalesEarningsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('SALES_EARNINGS_SCHEDULER') === 'off' || process.env.NODE_ENV === 'test') {
      this.logger.log('Sales earnings scheduler is off');
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

  async tick() {
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('zaroda-sales-earnings')) AS locked`;
          if (!rows[0]?.locked) return null;
          return this.earnings.accrue(true);
        },
        { timeout: RUN_TIMEOUT_MS, maxWait: 15_000 },
      );
      if (result && (result.commission || result.bonuses)) this.logger.log(result, 'Sales earnings accrued');
    } catch (e) {
      this.logger.error({ err: e }, 'Sales earnings accrual failed');
    }
  }
}
