import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { SeasonalBillingService } from './seasonal-billing.service';

const FIRST_RUN_DELAY_MS = 4 * 60_000;
const INTERVAL_MS = 60 * 60_000;

/**
 * The seasonal billing daily work, checked hourly (each step is safe to repeat): next school year's schedule in December, reminder
 * texts (daytime in Nairobi only), and "paid until" kept in step. A Postgres advisory lock keeps it to one API instance at a time.
 * SEASONAL_SCHEDULER=off turns it off. The read-only lock itself needs no job: it follows from the dates on every request.
 */
@Injectable()
export class SeasonalSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SeasonalSchedulerService.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: SeasonalBillingService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('SEASONAL_SCHEDULER') === 'off' || process.env.NODE_ENV === 'test') {
      this.logger.log('Seasonal billing scheduler is off');
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
      const hour = (new Date().getUTCHours() + 3) % 24;
      const result = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('zaroda-seasonal-billing')) AS locked`;
          if (!rows[0]?.locked) return null;
          return this.billing.runDaily(undefined, hour >= 8 && hour < 20);
        },
        { timeout: 15 * 60_000, maxWait: 15_000 },
      );
      if (result && (result.scheduled || result.reminders)) this.logger.log(result, 'Seasonal billing run');
    } catch (e) {
      this.logger.error({ err: e }, 'Seasonal billing run failed');
    }
  }
}
