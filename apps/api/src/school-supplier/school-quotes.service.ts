import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SchoolQuoteStatus } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { variantTitle } from '../catalog/variant-title';
import {
  AcceptQuoteDto,
  DeclineQuoteDto,
  SaveQuoteDto,
} from './dto/school-supplier.dto';
import { DocumentNumbersService } from './document-numbers.service';
import { detailTable, SchoolNotifierService } from './school-notifier.service';
import { documentTotals, lineAmounts, todayKey } from './school-money.util';
import { SchoolOrdersService } from './school-orders.service';
import {
  defaultValidUntil,
  mergeQuoteLines,
  quoteExpired,
} from './school-quote.util';

const include = {
  lines: { orderBy: { productName: 'asc' as const } },
  school: {
    select: {
      id: true,
      name: true,
      contactName: true,
      phone: true,
      email: true,
      address: true,
    },
  },
  order: { select: { id: true, orderNumber: true } },
  revisionOf: { select: { id: true, quoteNumber: true } },
} satisfies Prisma.SchoolQuoteInclude;
type QuoteFull = Prisma.SchoolQuoteGetPayload<{ include: typeof include }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toQuoteView(q: QuoteFull) {
  const lines = q.lines.map((l) => {
    const a = lineAmounts({
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
    });
    return {
      id: l.id,
      variantId: l.variantId,
      description: l.productName,
      sku: l.variantSku,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
      lineTotal: a.lineTotal,
      taxAmount: a.taxAmount,
    };
  });
  const totals = documentTotals(
    q.lines.map((l) => ({
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
    })),
  );
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    status: q.status,
    school: q.school,
    validUntil: day(q.validUntil),
    terms: q.terms,
    issueDate: day(q.issueDate),
    decidedAt: q.decidedAt,
    decidedBy: q.decidedBy,
    decisionNote: q.decisionNote,
    order: q.order,
    revisionOf: q.revisionOf,
    lines,
    ...totals,
  };
}

/**
 * Quotations to schools. A draft can change; issuing numbers and freezes it and tells the school. The school accepts in its
 * portal (or the supplier records an acceptance that came by phone or LPO): that makes an order at the quoted prices, which the
 * supplier then confirms and delivers as usual. A quotation that is not accepted by its valid-until date expires by itself.
 */
@Injectable()
export class SchoolQuotesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly numbers: DocumentNumbersService,
    private readonly orders: SchoolOrdersService,
    private readonly notifier: SchoolNotifierService,
    private readonly config: ConfigService,
  ) {}

  /** Issued quotations whose date has passed become EXPIRED (done whenever they are listed, so no timer is needed). */
  private async expireOld(tx: TenantTx) {
    await tx.schoolQuote.updateMany({
      where: {
        status: SchoolQuoteStatus.ISSUED,
        validUntil: { lt: new Date(`${todayKey()}T00:00:00Z`) },
      },
      data: { status: SchoolQuoteStatus.EXPIRED },
    });
  }

  /** The lines of a quotation as written down: product, price (the school's price unless one was given) and VAT. */
  private async priceLines(tx: TenantTx, input: SaveQuoteDto['lines']) {
    const merged = mergeQuoteLines(input);
    if (merged.problem) throw new BadRequestException(merged.problem);
    const variants = await tx.productVariant.findMany({
      where: {
        id: { in: merged.lines.map((l) => l.variantId) },
        product: { isActive: true },
      },
      include: {
        product: {
          select: {
            name: true,
            taxClass: { select: { rate: true, isExempt: true } },
          },
        },
      },
    });
    if (variants.length !== merged.lines.length)
      throw new BadRequestException(
        'One of the products does not exist or is no longer sold.',
      );
    const byId = new Map(variants.map((v) => [v.id, v]));
    return merged.lines.map((l) => {
      const v = byId.get(l.variantId)!;
      const tc = v.product.taxClass;
      return {
        variantId: v.id,
        productName: variantTitle(v.product.name, v.name),
        variantSku: v.sku,
        quantity: l.quantity,
        unitPrice: l.unitPrice ?? Number(v.schoolPrice ?? v.price),
        taxRate: tc && !tc.isExempt ? Number(tc.rate) : 0,
      };
    });
  }

  async create(dto: SaveQuoteDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const row = await this.tenantPrisma.run(async (tx) => {
      const school = await tx.supplierSchool.findUnique({
        where: { id: dto.schoolId },
      });
      if (!school) throw new NotFoundException('School not found');
      const lines = await this.priceLines(tx, dto.lines);
      return tx.schoolQuote.create({
        data: {
          organizationId,
          schoolId: dto.schoolId,
          validUntil: dto.validUntil
            ? new Date(`${dto.validUntil}T00:00:00Z`)
            : null,
          terms: dto.terms?.trim() || null,
          createdById: orgUserId,
          lines: { create: lines },
        },
        include,
      });
    });
    return toQuoteView(row);
  }

  /** Replaces a draft's school, date, terms and lines. An issued quotation is frozen: revise it instead. */
  async update(id: string, dto: SaveQuoteDto) {
    const row = await this.tenantPrisma.run(async (tx) => {
      const current = await tx.schoolQuote.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Quotation not found');
      if (current.status !== SchoolQuoteStatus.DRAFT)
        throw new ConflictException(
          'Only a draft can be changed. Revise an issued quotation to make a new draft.',
        );
      const lines = await this.priceLines(tx, dto.lines);
      await tx.schoolQuoteLine.deleteMany({ where: { quoteId: id } });
      return tx.schoolQuote.update({
        where: { id },
        data: {
          schoolId: dto.schoolId,
          validUntil: dto.validUntil
            ? new Date(`${dto.validUntil}T00:00:00Z`)
            : null,
          terms: dto.terms?.trim() || null,
          lines: { create: lines },
        },
        include,
      });
    });
    return toQuoteView(row);
  }

  async remove(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const res = await tx.schoolQuote.deleteMany({
        where: { id, status: SchoolQuoteStatus.DRAFT },
      });
      if (res.count === 0)
        throw new ConflictException(
          'Only a draft can be deleted. An issued quotation stays on record.',
        );
      return { ok: true };
    });
  }

  /** Numbers and freezes the quotation, and tells the school. A revision supersedes the quotation it replaces. */
  async issue(id: string) {
    const { organizationId } = getTenantStore();
    const row = await this.tenantPrisma.run(async (tx) => {
      const current = await tx.schoolQuote.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!current) throw new NotFoundException('Quotation not found');
      if (current.status !== SchoolQuoteStatus.DRAFT)
        throw new ConflictException('That quotation was already issued.');
      if (current.lines.length === 0)
        throw new BadRequestException('A quotation needs at least one item.');
      const today = todayKey();
      const validUntil = current.validUntil
        ? day(current.validUntil)!
        : defaultValidUntil(today);
      if (quoteExpired(validUntil, today))
        throw new BadRequestException(
          'The valid-until date is already in the past.',
        );
      const quoteNumber = await this.numbers.next(tx, organizationId, 'QT');
      const res = await tx.schoolQuote.updateMany({
        where: { id, status: SchoolQuoteStatus.DRAFT },
        data: {
          status: SchoolQuoteStatus.ISSUED,
          quoteNumber,
          issueDate: new Date(`${today}T00:00:00Z`),
          issuedAt: new Date(),
          validUntil: new Date(`${validUntil}T00:00:00Z`),
        },
      });
      if (res.count === 0)
        throw new ConflictException('That quotation was just issued.');
      if (current.revisionOfId)
        await tx.schoolQuote.updateMany({
          where: {
            id: current.revisionOfId,
            status: {
              in: [
                SchoolQuoteStatus.ISSUED,
                SchoolQuoteStatus.DECLINED,
                SchoolQuoteStatus.EXPIRED,
              ],
            },
          },
          data: { status: SchoolQuoteStatus.SUPERSEDED },
        });
      return tx.schoolQuote.findUniqueOrThrow({ where: { id }, include });
    });
    const view = toQuoteView(row);
    await this.tellSchool(
      row,
      `Quotation ${row.quoteNumber}`,
      `we have sent you quotation ${row.quoteNumber} for KES ${view.total.toFixed(2)}, open until ${view.validUntil}. You can accept it in your portal and it becomes your order.`,
      detailTable(
        ['Item', 'Qty', 'Price', 'Amount'],
        view.lines.map((l) => [
          l.description,
          String(l.quantity),
          l.unitPrice.toFixed(2),
          (l.lineTotal + l.taxAmount).toFixed(2),
        ]),
      ),
    );
    return view;
  }

  /**
   * The school says yes (or the supplier records that it did): the quotation is accepted and an order is made at the quoted
   * prices. Refused once the quotation has run out, so a stale price is never honoured by accident.
   */
  async accept(
    id: string,
    by: 'SCHOOL' | 'SUPPLIER',
    dto: AcceptQuoteDto,
    schoolId?: string,
  ) {
    const { organizationId } = getTenantStore();
    const { quote, order } = await this.tenantPrisma.run(async (tx) => {
      await this.expireOld(tx);
      const current = await tx.schoolQuote.findFirst({
        where: { id, ...(schoolId ? { schoolId } : {}) },
        include: { lines: true },
      });
      if (!current) throw new NotFoundException('Quotation not found');
      if (current.status === SchoolQuoteStatus.EXPIRED)
        throw new ConflictException(
          'This quotation has expired. Ask the supplier for a new one.',
        );
      if (current.status !== SchoolQuoteStatus.ISSUED)
        throw new ConflictException(
          'This quotation can no longer be accepted - it is already answered or replaced.',
        );
      const claim = await tx.schoolQuote.updateMany({
        where: { id, status: SchoolQuoteStatus.ISSUED },
        data: {
          status: SchoolQuoteStatus.ACCEPTED,
          decidedAt: new Date(),
          decidedBy: by,
        },
      });
      if (claim.count === 0)
        throw new ConflictException('This quotation was just answered.');
      const o = await this.orders.createFromQuoteInTx(
        tx,
        organizationId,
        current,
        dto,
      );
      await tx.schoolQuote.update({ where: { id }, data: { orderId: o.id } });
      return {
        quote: await tx.schoolQuote.findUniqueOrThrow({
          where: { id },
          include,
        }),
        order: o,
      };
    });
    await this.orders.announceNewOrder(order, quote.quoteNumber);
    if (by === 'SUPPLIER')
      await this.tellSchool(
        quote,
        `Quotation ${quote.quoteNumber} accepted`,
        `your acceptance of quotation ${quote.quoteNumber} is recorded and it is now order ${order.orderNumber}. We will confirm it and deliver.`,
      );
    return toQuoteView(quote);
  }

  async decline(
    id: string,
    by: 'SCHOOL' | 'SUPPLIER',
    dto: DeclineQuoteDto,
    schoolId?: string,
  ) {
    const row = await this.tenantPrisma.run(async (tx) => {
      await this.expireOld(tx);
      const res = await tx.schoolQuote.updateMany({
        where: {
          id,
          status: SchoolQuoteStatus.ISSUED,
          ...(schoolId ? { schoolId } : {}),
        },
        data: {
          status: SchoolQuoteStatus.DECLINED,
          decidedAt: new Date(),
          decidedBy: by,
          decisionNote: dto.reason?.trim() || null,
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'This quotation cannot be declined - it is already answered, replaced or expired.',
        );
      return tx.schoolQuote.findUniqueOrThrow({ where: { id }, include });
    });
    return toQuoteView(row);
  }

  /** A new draft copied from an issued, declined or expired quotation; issuing it supersedes the original. */
  async revise(id: string) {
    const { organizationId, orgUserId } = getTenantStore();
    const row = await this.tenantPrisma.run(async (tx) => {
      await this.expireOld(tx);
      const original = await tx.schoolQuote.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!original) throw new NotFoundException('Quotation not found');
      const revisable: SchoolQuoteStatus[] = [
        SchoolQuoteStatus.ISSUED,
        SchoolQuoteStatus.DECLINED,
        SchoolQuoteStatus.EXPIRED,
      ];
      if (!revisable.includes(original.status))
        throw new ConflictException(
          'Only an issued, declined or expired quotation can be revised.',
        );
      return tx.schoolQuote.create({
        data: {
          organizationId,
          schoolId: original.schoolId,
          terms: original.terms,
          revisionOfId: original.id,
          createdById: orgUserId,
          lines: {
            create: original.lines.map((l) => ({
              variantId: l.variantId,
              productName: l.productName,
              variantSku: l.variantSku,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
            })),
          },
        },
        include,
      });
    });
    return toQuoteView(row);
  }

  async list(status?: string, schoolId?: string) {
    const rows = await this.tenantPrisma.run(async (tx) => {
      await this.expireOld(tx);
      return tx.schoolQuote.findMany({
        where: {
          ...(status ? { status: status as SchoolQuoteStatus } : {}),
          ...(schoolId ? { schoolId } : {}),
        },
        include,
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
    });
    return rows.map(toQuoteView);
  }

  async get(id: string, schoolId?: string) {
    const row = await this.tenantPrisma.run(async (tx) => {
      await this.expireOld(tx);
      return tx.schoolQuote.findFirst({
        where: {
          id,
          ...(schoolId
            ? {
                schoolId,
                status: {
                  notIn: [SchoolQuoteStatus.DRAFT],
                },
              }
            : {}),
        },
        include,
      });
    });
    if (!row) throw new NotFoundException('Quotation not found');
    return toQuoteView(row);
  }

  /** What a school sees: everything issued to it (not drafts), newest first. */
  async listForSchool(schoolId: string) {
    const rows = await this.tenantPrisma.run(async (tx) => {
      await this.expireOld(tx);
      return tx.schoolQuote.findMany({
        where: { schoolId, status: { not: SchoolQuoteStatus.DRAFT } },
        include,
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    });
    return rows.map(toQuoteView);
  }

  private async tellSchool(
    q: QuoteFull,
    subject: string,
    message: string,
    detailHtml?: string,
  ) {
    const { organizationId } = getTenantStore();
    const { org, slug } = await this.tenantPrisma.run(async (tx) => ({
      org: await tx.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      slug: (
        await tx.schoolPortal.findUnique({
          where: { organizationId },
          select: { slug: true },
        })
      )?.slug,
    }));
    const base = (
      this.config.get<string>('STOREFRONT_BASE_URL') ??
      'https://shop.zarodashop.com'
    ).replace(/\/+$/, '');
    await this.notifier.notify(
      {
        name: q.school.contactName ?? q.school.name,
        phone: q.school.phone,
        email: q.school.email,
      },
      org?.name ?? 'Your supplier',
      subject,
      message,
      {
        detailHtml,
        link: slug
          ? { label: 'Open your portal', url: `${base}/schools/${slug}` }
          : undefined,
      },
    );
  }
}
