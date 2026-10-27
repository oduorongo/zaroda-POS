import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { tenantContext } from '../common/tenant/tenant-context';
import { LedgerPosterService } from './ledger-poster.service';

const FIRST_RUN_DELAY_MS = 120_000;
const INTERVAL_MS = 5 * 60_000;

/**
 * Posts every business's new sales, expenses, bills, payments... to its books every five minutes, in the API process like the eTIMS
 * timer. Two instances never post the same thing: each source has one posting row, written under a per-business database lock.
 * LEDGER_SCHEDULER=off turns the timer off (the "post now" button still works).
 */
@Injectable()
export class LedgerSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerSchedulerService.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly poster: LedgerPosterService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('LEDGER_SCHEDULER') === 'off' || process.env.NODE_ENV === 'test') {
      this.logger.log('Posting to the books on a timer is off');
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

  /** One timed pass over every business. Never throws. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.prisma.organization.findMany({ select: { id: true } });
      for (const { id: organizationId } of orgs) {
        try {
          const r = await tenantContext.run({ organizationId, orgUserId: 'system', role: Role.OWNER }, () => this.poster.runPass());
          if (r.posted || r.reposted || r.reversed || r.failed) this.logger.log({ organizationId, ...r }, 'Posted to the books');
        } catch (e) {
          this.logger.error({ err: e, organizationId }, 'Posting to the books failed for a business');
        }
      }
    } catch (e) {
      this.logger.error({ err: e }, 'Posting to the books failed');
    } finally {
      this.running = false;
    }
  }
}
