import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { RentalBillingService } from './rental-billing.service';
import { RentalMpesaService } from './rental-mpesa.service';
import { RentalRemindersService } from './rental-reminders.service';
import { trimCaretakersToPlan } from './rental-plans.service';

// First run shortly after boot (so a restart after downtime catches up), then once an hour. Generating
// invoices is idempotent, so a pass with nothing to do is cheap.
const FIRST_RUN_DELAY_MS = 3 * 60_000;
const INTERVAL_MS = 60 * 60_000;
const TX_OPTIONS = { timeout: 60_000, maxWait: 15_000 };

/**
 * Creates each landlord's monthly rent invoices automatically, so they are waiting on the due day without
 * anyone pressing a button. Runs inside the API process like the commission scheduler, with a Postgres advisory
 * lock so only one instance works at a time. RENTAL_SCHEDULER=off turns it off. Landlords who open the Rentals
 * screen get the same catch-up anyway (RentalBillingService.dues), so a sleeping host never leaves them stuck.
 */
@Injectable()
export class RentalSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RentalSchedulerService.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: RentalBillingService,
    private readonly mpesa: RentalMpesaService,
    private readonly reminders: RentalRemindersService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('RENTAL_SCHEDULER') === 'off' || process.env.NODE_ENV === 'test') {
      this.logger.log('Rental scheduler is off');
      return;
    }
    this.firstRun = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    this.firstRun.unref();
    this.interval = setInterval(() => void this.tick(), INTERVAL_MS);
    this.interval.unref();
    this.logger.log('Rental scheduler on: monthly rent invoices are created automatically');
  }

  onModuleDestroy() {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.interval) clearInterval(this.interval);
  }

  /** Public so a test (or a one-off script) can run one pass. */
  async tick() {
    try {
      const organizations = await this.prisma.organization.findMany({
        where: { industryType: 'RENTAL' },
        select: { id: true },
      });
      let created = 0;
      for (const org of organizations) {
        created += await this.prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${'zaroda-rental-billing:' + org.id})) AS locked`;
          if (!rows[0]?.locked) return 0; // another instance is already on this business
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${org.id}, true)`;
          const dropped = await trimCaretakersToPlan(tx, org.id);
          if (dropped > 0) this.logger.log({ organizationId: org.id, dropped }, 'Caretaker accounts deactivated: plan includes fewer');
          return this.billing.syncOrganization(tx, org.id);
        }, TX_OPTIONS);
        // Prompts still waiting after a missed callback: ask Safaricom (free) for landlords on their own Paybill/Till.
        await this.mpesa.reconcileDaraja(org.id).catch((e) => this.logger.warn({ err: e }, 'Rent prompt reconcile failed'));
        // Rent reminders for landlords who switched them on (daytime only; each stage goes out once).
        await this.reminders.runForOrganization(org.id).catch((e) => this.logger.warn({ err: e }, 'Rent reminders failed'));
      }
      if (created > 0) this.logger.log({ created }, 'Rental invoices created');
    } catch (e) {
      // A failed pass must never take the API down; the next tick tries again.
      this.logger.error({ err: e }, 'Rental billing pass failed');
    }
  }
}
