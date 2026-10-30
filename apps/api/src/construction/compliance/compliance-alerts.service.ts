import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { brandButton, brandedEmail } from '../../common/email/brand-layout';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AfricasTalkingSmsProvider } from '../../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../../notifications/resend-email.provider';
import { asOrg } from '../common/con-access';
import { constructionUrl } from '../common/con-domain';
import { WORKS_CLASS_LABELS, alertKey, alertStage, alertText, todayKey } from './compliance.util';

const FIRST_RUN_DELAY_MS = 2 * 60_000;
const INTERVAL_MS = 6 * 60 * 60_000;
const COMPLIANCE_HREF = '/construction/compliance';

interface NewAlert {
  title: string;
  body: string;
}

/**
 * Expiry alerts for the compliance vault: 60, 30 and 7 days before a document or NCA licence expires, and once it has expired.
 * Each stage is raised once (con_alerts.dedupeKey), in-app, and emailed / texted where those are configured. Runs in the API
 * process every few hours with a per-business advisory lock; CONSTRUCTION_SCHEDULER=off turns it off.
 */
@Injectable()
export class ComplianceAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ComplianceAlertsService.name);
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly email: ResendEmailProvider,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('CONSTRUCTION_SCHEDULER') === 'off' || process.env.NODE_ENV === 'test') return;
    const first = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    const every = setInterval(() => void this.tick(), INTERVAL_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async tick(now: Date = new Date()) {
    const orgs = await this.prisma.organization.findMany({ where: { industryType: 'CONSTRUCTION', isActive: true }, select: { id: true } });
    let raised = 0;
    for (const org of orgs) raised += await this.runForOrganization(org.id, todayKey(now)).catch((e) => (this.logger.warn({ err: e, organizationId: org.id }, 'Compliance alerts failed'), 0));
    if (raised > 0) this.logger.log({ raised }, 'Construction compliance alerts raised');
    return raised;
  }

  async runForOrganization(organizationId: string, today: string): Promise<number> {
    const fresh = await asOrg(this.prisma, organizationId, async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${'zaroda-con-alerts:' + organizationId})) AS locked`;
      if (!rows[0]?.locked) return [];
      const [docs, regs] = await Promise.all([
        tx.conComplianceDoc.findMany({ where: { expiresAt: { not: null } } }),
        tx.conCompanyRegistration.findMany({ where: { licenceExpiresAt: { not: null } } }),
      ]);
      const items = [
        ...docs.map((d) => ({ kind: 'doc', id: d.id, name: d.title, expires: d.expiresAt!.toISOString().slice(0, 10) })),
        ...regs.map((r) => ({ kind: 'nca', id: r.id, name: `NCA${r.ncaCategory} licence (${WORKS_CLASS_LABELS[r.worksClass]})`, expires: r.licenceExpiresAt!.toISOString().slice(0, 10) })),
      ];
      const out: NewAlert[] = [];
      for (const item of items) {
        const stage = alertStage(item.expires, today);
        if (stage === null) continue;
        const text = alertText(item.name, item.expires, stage);
        const res = await tx.conAlert.createMany({
          data: [{ organizationId, kind: stage === 0 ? 'EXPIRED' : 'EXPIRING', ...text, href: COMPLIANCE_HREF, dedupeKey: alertKey(item.kind, item.id, item.expires, stage) }],
          skipDuplicates: true,
        });
        if (res.count === 1) out.push(text);
      }
      return out;
    });
    if (fresh.length) await this.notify(organizationId, fresh).catch((e) => this.logger.warn({ err: e, organizationId }, 'Compliance alert email/SMS failed'));
    return fresh.length;
  }

  private async notify(organizationId: string, alerts: NewAlert[]) {
    const { org, emails } = await asOrg(this.prisma, organizationId, async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, email: true, phone: true } });
      const people = await tx.orgUser.findMany({
        where: { isActive: true, OR: [{ role: Role.OWNER }, { conUserRoles: { some: { role: { in: ['CON_DIRECTOR', 'CON_COMPLIANCE'] } } } }] },
        select: { user: { select: { email: true } } },
      });
      return { org, emails: [...new Set([...people.map((p) => p.user.email), ...(org.email ? [org.email] : [])])] };
    });
    const link = constructionUrl(COMPLIANCE_HREF);
    if (this.email.isConfigured() && emails.length) {
      const list = alerts.map((a) => `<li style="margin-bottom:8px"><strong>${escape(a.title)}</strong><br>${escape(a.body)}</li>`).join('');
      const html = brandedEmail({ title: 'Compliance documents need attention', bodyHtml: `<p>${escape(org.name)}:</p><ul>${list}</ul>${link ? `<p>${brandButton('Open the compliance vault', link)}</p>` : ''}` });
      for (const to of emails) await this.email.sendEmail({ to, subject: `${alerts.length === 1 ? alerts[0].title : `${alerts.length} compliance documents need attention`} - ${org.name}`, html });
    }
    if (org.phone) {
      const message = `${org.name}: ${alerts.map((a) => a.title).join('; ')}.${link ? ` ${link}` : ''}`.slice(0, 300);
      await this.sms.sendSms({ to: org.phone, message });
    }
  }

  // ── In-app ──

  list() {
    return this.tenantPrisma.run((tx) => tx.conAlert.findMany({ orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }], take: 50 }));
  }

  markRead(id?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const res = await tx.conAlert.updateMany({ where: { readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
      return { updated: res.count };
    });
  }
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
