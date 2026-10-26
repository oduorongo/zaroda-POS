import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, TenderAdvertStatus, TenderBuyerStatus } from '@prisma/client';
import { brandButton, brandedEmail } from '../common/email/brand-layout';
import { PrismaService } from '../common/prisma/prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { addDays, daysBetween, todayKey } from '../school-supplier/school-money.util';
import { TenderBoardQueryDto } from './dto/tender-advert.dto';
import { AdvertItem, matchesSearch } from './tender-advert.util';

const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 };
const day = (d: Date) => d.toISOString().slice(0, 10);
const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The most businesses one advert is emailed to: more than this is a platform job, not a request. */
const MAX_ALERTED = 1000;

const advertInclude = {
  buyer: { select: { name: true, county: true } },
} satisfies Prisma.TenderAdvertInclude;
type AdvertRow = Prisma.TenderAdvertGetPayload<{
  include: typeof advertInclude;
}>;

/** An advert as a supplier sees it. */
export function advertForSupplier(a: AdvertRow, today: string, pdfUrl: string | null) {
  const closing = day(a.closingDate);
  return {
    id: a.id,
    reference: a.reference,
    title: a.title,
    description: a.description,
    county: a.county,
    items: a.items as unknown as AdvertItem[],
    documentsInfo: a.documentsInfo,
    pdfUrl,
    pdfName: a.pdfName,
    closingDate: closing,
    daysLeft: daysBetween(today, closing),
    open: closing >= today,
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    contactEmail: a.contactEmail,
    school: { name: a.buyer.name, county: a.buyer.county },
    postedAt: a.createdAt,
  };
}

/**
 * What a school-supplier business sees of the tender adverts schools have posted: the open ones from approved schools, with
 * whether this business has already looked at, saved or dismissed each. Adverts live outside any one business (see rls.sql), so
 * they are read here with the plain client; what THIS business did with them is its own tenant data. Also sends the alert email
 * to every school-supplier business when a new advert is posted.
 */
@Injectable()
export class TenderBoardService {
  private readonly logger = new Logger(TenderBoardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
    private readonly storage: ObjectStorageService,
  ) {}

  private openWhere(today: string, includeClosed: boolean): Prisma.TenderAdvertWhereInput {
    return {
      status: TenderAdvertStatus.OPEN,
      buyer: { status: TenderBuyerStatus.APPROVED },
      closingDate: {
        gte: new Date(`${includeClosed ? addDays(today, -30) : today}T00:00:00Z`),
      },
    };
  }

  async list(q: TenderBoardQueryDto) {
    const today = todayKey();
    const where = this.openWhere(today, q.closed === 'true');
    if (q.county?.trim())
      where.county = { contains: q.county.trim(), mode: 'insensitive' };
    const rows = await this.prisma.tenderAdvert.findMany({
      where,
      include: advertInclude,
      orderBy: [{ closingDate: 'asc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const notices = await this.tenantPrisma.run((tx) =>
      tx.schoolTenderNotice.findMany({
        where: { advertId: { in: rows.map((r) => r.id) } },
      }),
    );
    const stateOf = new Map(notices.map((n) => [n.advertId, n.state]));
    const list = rows
      .map((r) => ({
        ...advertForSupplier(r, today, r.pdfKey ? this.storage.publicUrl(r.pdfKey) : null),
        state: (stateOf.get(r.id) ?? 'NEW') as 'NEW' | 'SEEN' | 'SAVED' | 'DISMISSED',
      }))
      .filter((a) =>
        q.show ? a.state === q.show : a.state !== 'DISMISSED',
      )
      .filter((a) =>
        matchesSearch(
          { ...a, schoolName: a.school.name },
          q.q ?? '',
        ),
      );
    return {
      rows: list,
      counts: {
        new: rows.filter((r) => !stateOf.has(r.id)).length,
        saved: rows.filter((r) => stateOf.get(r.id) === 'SAVED').length,
      },
    };
  }

  /** How many open adverts this business has not looked at yet (for the badge). */
  async newCount() {
    const today = todayKey();
    const open = await this.prisma.tenderAdvert.findMany({
      where: this.openWhere(today, false),
      select: { id: true },
      take: 1000,
    });
    const seen = await this.tenantPrisma.run((tx) =>
      tx.schoolTenderNotice.findMany({
        where: { advertId: { in: open.map((o) => o.id) } },
        select: { advertId: true },
      }),
    );
    return { new: open.length - seen.length };
  }

  async setState(advertId: string, state: 'SEEN' | 'SAVED' | 'DISMISSED') {
    const { organizationId } = getTenantStore();
    const exists = await this.prisma.tenderAdvert.findFirst({
      where: { id: advertId, status: TenderAdvertStatus.OPEN },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Advert not found');
    await this.tenantPrisma.run((tx) =>
      tx.schoolTenderNotice.upsert({
        where: { organizationId_advertId: { organizationId, advertId } },
        create: { organizationId, advertId, state },
        update: { state },
      }),
    );
    return { id: advertId, state };
  }

  /** Emails the owners and managers of every school-supplier business about a new advert. Never lets a failure reach the school. */
  async alertSuppliers(advertId: string): Promise<void> {
    try {
      if (!this.email.isConfigured()) return;
      const advert = await this.prisma.tenderAdvert.findUnique({
        where: { id: advertId },
        include: advertInclude,
      });
      if (!advert || advert.status !== TenderAdvertStatus.OPEN) return;
      const base = this.config.get<string>('BACKOFFICE_BASE_URL');
      const link = base
        ? brandButton(
            'See the advert',
            `${base.replace(/\/$/, '')}/school-tender-adverts`,
          )
        : '';
      const closing = day(advert.closingDate);
      const html = brandedEmail({
        title: 'New tender advert',
        bodyHtml: `<p><strong>${escapeHtml(advert.title)}</strong></p><p>${escapeHtml(advert.buyer.name)}, ${escapeHtml(advert.county)}. Closes ${closing}.</p><p>${escapeHtml(advert.description.slice(0, 400))}</p>${link ? `<p style="margin-top:16px">${link}</p>` : ''}`,
      });
      const orgs = await this.prisma.organization.findMany({
        where: { industryType: 'SCHOOL_SUPPLIER' },
        select: { id: true, email: true },
        take: MAX_ALERTED,
      });
      for (const org of orgs) {
        const people = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${org.id}, true)`;
          return tx.orgUser.findMany({
            where: { isActive: true, role: { in: [Role.OWNER, Role.MANAGER] } },
            select: { user: { select: { email: true } } },
          });
        }, TX_OPTIONS);
        const to = Array.from(
          new Set([org.email, ...people.map((p) => p.user.email)].filter((e): e is string => Boolean(e))),
        );
        for (const address of to)
          await this.email
            .sendEmail({
              to: address,
              subject: `New tender: ${advert.title}`,
              html,
              text: `${advert.title} - ${advert.buyer.name}, ${advert.county}. Closes ${closing}.`,
            })
            .catch(() => undefined);
      }
    } catch (e) {
      this.logger.error({ err: e }, 'Could not alert suppliers about a tender advert');
    }
  }
}
