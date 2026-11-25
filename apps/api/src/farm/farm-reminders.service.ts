import { smsParts } from '../construction/plans/con-addons.util';
import { FarmBillingService } from './farm-billing.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { asOrg, shambaUrl } from './farm-access';
import { addDays, asDate, dayOf, todayKey } from './farm-livestock.util';
import { FarmSetupService } from './farm-setup.service';
import { FALLBACK_PLAN } from './farm-plans.util';

const INTERVAL_MS = 60 * 60_000;
/** Remind this many days before a task is due (and on the day). */
export const REMIND_BEFORE = [7, 3, 1, 0];
/** Reminders go out from this hour, East Africa time. */
const SEND_FROM_HOUR = 7;

/** Which open tasks get a reminder today: due in 7, 3 or 1 days, today, or overdue and not reminded since they fell due. */
export function toRemind<T extends { dueOn: Date; remindedOn: Date | null }>(tasks: T[], today: string): T[] {
  return tasks.filter((t) => {
    const due = dayOf(t.dueOn);
    const reminded = t.remindedOn ? dayOf(t.remindedOn) : null;
    if (reminded === today) return false;
    if (due < today) return !reminded || reminded < due;
    return REMIND_BEFORE.some((n) => addDays(today, n) === due);
  });
}

export function reminderText(farm: string, tasks: { title: string; dueOn: Date }[], today: string, link: string | null): string {
  const when = (d: string) => (d < today ? 'overdue' : d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : d);
  const lines = tasks.slice(0, 5).map((t) => `${t.title} - ${when(dayOf(t.dueOn))}`);
  const more = tasks.length > 5 ? `\n+${tasks.length - 5} more` : '';
  return `Zaroda Shamba - ${farm}:\n${lines.join('\n')}${more}${link ? `\n${link}` : ''}`;
}

/**
 * Once a day (from 7am), texts each farm on a plan with vaccination programmes about doses, drying off and births coming up,
 * then emails the same. FARM_REMINDERS=off turns it off.
 */
@Injectable()
export class FarmRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FarmRemindersService.name);
  private interval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly setup: FarmSetupService,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly email: ResendEmailProvider,
    private readonly billing: FarmBillingService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('FARM_REMINDERS') === 'off' || process.env.NODE_ENV === 'test') return;
    this.interval = setInterval(() => void this.tick(), INTERVAL_MS);
    this.interval.unref();
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  async tick(now: Date = new Date()) {
    if (this.running || new Date(now.getTime() + 3 * 3600_000).getUTCHours() < SEND_FROM_HOUR) return;
    this.running = true;
    try {
      const farms = await this.prisma.organization.findMany({ where: { industryType: 'FARM' }, select: { id: true, name: true, phone: true, email: true } });
      const plans = await this.setup.activePlans();
      for (const org of farms) {
        try {
          await this.remindFarm(org, plans, todayKey(now));
        } catch (e) {
          this.logger.error({ err: e, organizationId: org.id }, 'Farm reminders failed');
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async remindFarm(org: { id: string; name: string; phone: string | null; email: string | null }, plans: Awaited<ReturnType<FarmSetupService['activePlans']>>, today: string) {
    const tasks = await asOrg(this.prisma, org.id, async (tx) => {
      const sub = await tx.farmSubscription.findUnique({ where: { organizationId: org.id } });
      const plan = plans.find((p) => p.code === (sub?.planCode ?? FALLBACK_PLAN));
      if (!plan?.features.includes('programmes') || sub?.status === 'SUSPENDED' || sub?.status === 'CANCELLED') return [];
      const open = await tx.farmDueTask.findMany({ where: { doneOn: null, cancelledAt: null, dueOn: { lte: asDate(addDays(today, 7)) } }, orderBy: { dueOn: 'asc' } });
      const pick = toRemind(open, today);
      if (pick.length) await tx.farmDueTask.updateMany({ where: { id: { in: pick.map((t) => t.id) } }, data: { remindedOn: asDate(today) } });
      return pick;
    });
    if (!tasks.length) return;
    const text = reminderText(org.name, tasks, today, shambaUrl('/shamba/health'));
    const parts = smsParts(text);
    if (org.phone && (await this.billing.takeSms(org.id, parts))) {
      const sent = await this.sms.sendSms({ to: org.phone, message: text }).catch(() => ({ sent: false }));
      if (!sent.sent) await this.billing.returnSms(org.id, parts);
    }
    if (org.email) {
      const html = `<p>${text.split('\n').map(escape).join('<br>')}</p>`;
      await this.email.sendEmail({ to: org.email, subject: `Zaroda Shamba: ${tasks.length} farm task${tasks.length === 1 ? '' : 's'} coming up`, html, text }).catch(() => undefined);
    }
    this.logger.log({ organizationId: org.id, tasks: tasks.length }, 'Farm reminders sent');
  }
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
