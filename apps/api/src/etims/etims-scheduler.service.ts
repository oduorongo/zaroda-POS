import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { tenantContext } from '../common/tenant/tenant-context';
import { EtimsDocumentsService } from './etims-documents.service';
import { EtimsExtrasService } from './etims-extras.service';

const FIRST_RUN_DELAY_MS = 90_000;
const INTERVAL_MS = 60_000;

/**
 * Sends each business's waiting sales to KRA once a minute, in the API process like the hotel jobs. Two instances never send the same
 * document: each one is claimed for a couple of minutes under a database lock before it is sent, and every step is remembered. ETIMS_SCHEDULER=off turns the timer off.
 */
@Injectable()
export class EtimsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EtimsSchedulerService.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly documents: EtimsDocumentsService,
    private readonly extras: EtimsExtrasService,
  ) {}

  onModuleInit() {
    if (
      this.config.get<string>('ETIMS_SCHEDULER') === 'off' ||
      process.env.NODE_ENV === 'test'
    ) {
      this.logger.log('Sending sales to KRA on a timer is off');
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

  /** One timed pass over every business that sends sales. Never throws. */
  async tick(now: Date = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      // each business's own passes are cheap when it does not send sales (two small queries), and etims_settings is row-level protected
      const orgs = await this.prisma.organization.findMany({
        select: { id: true },
      });
      for (const { id: organizationId } of orgs) {
        try {
          const r = await tenantContext.run(
            { organizationId, orgUserId: 'system', role: Role.OWNER },
            async () => {
              const pass = await this.documents.runPass(now);
              // customers with a KRA PIN go to KRA too; a failure here never stops the sales
              await this.extras.syncCustomers().catch((e) =>
                this.logger.warn({ err: e, organizationId }, 'Sending customers to KRA failed'),
              );
              return pass;
            },
          );
          if (r.queued || r.sent || r.rejected)
            this.logger.log({ organizationId, ...r }, 'Sales sent to KRA');
        } catch (e) {
          this.logger.error(
            { err: e, organizationId },
            'Sending sales to KRA failed for a business',
          );
        }
      }
    } catch (e) {
      this.logger.error({ err: e }, 'Sending sales to KRA failed');
    } finally {
      this.running = false;
    }
  }
}
