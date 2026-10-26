import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InventoryTxnType,
  Prisma,
  SchoolCreditReason,
  SupplierInvoiceStatus,
} from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { CreateCreditNoteDto } from './dto/school-supplier.dto';
import { DocumentNumbersService } from './document-numbers.service';
import {
  creditableQuantity,
  planCreditNote,
  statusAfterSettlement,
} from './school-credit.util';
import { detailTable, SchoolNotifierService } from './school-notifier.service';
import { fromCents, toCents, todayKey } from './school-money.util';

const include = {
  lines: { orderBy: { description: 'asc' as const } },
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
  invoice: { select: { id: true, invoiceNumber: true } },
} satisfies Prisma.SupplierCreditNoteInclude;
type CreditFull = Prisma.SupplierCreditNoteGetPayload<{
  include: typeof include;
}>;

export const REASON_WORDS: Record<SchoolCreditReason, string> = {
  RETURNED: 'Goods returned',
  DAMAGED: 'Goods damaged',
  SHORT_DELIVERY: 'Short delivery',
  PRICE_ERROR: 'Price correction',
  OTHER: 'Other',
};

const day = (d: Date) => d.toISOString().slice(0, 10);

export function toCreditView(c: CreditFull) {
  return {
    id: c.id,
    creditNumber: c.creditNumber,
    issueDate: day(c.issueDate),
    reason: c.reason,
    reasonText: REASON_WORDS[c.reason],
    note: c.note,
    school: c.school,
    invoice: c.invoice,
    subtotal: Number(c.subtotal),
    taxAmount: Number(c.taxAmount),
    total: Number(c.total),
    /** True when some of the goods went back into stock. */
    restocked: c.lines.some((l) => Number(l.quantityRestocked) > 0),
    lines: c.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
      lineTotal: Number(l.lineTotal),
      taxAmount: Number(l.taxAmount),
      quantityRestocked: Number(l.quantityRestocked),
    })),
  };
}

/**
 * Credit notes to schools: goods sent back, a short delivery, a wrong price. A credit note lowers what the school owes on the
 * invoice (it settles part of it, like a payment does), can put the returned goods back in stock, and is recorded as a refund
 * of the sale the invoice became, so the sales reports and profit follow.
 */
@Injectable()
export class SchoolCreditNotesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
    private readonly numbers: DocumentNumbersService,
    private readonly notifier: SchoolNotifierService,
    private readonly config: ConfigService,
  ) {}

  /** What can still be credited on an invoice, line by line. */
  async creditable(invoiceId: string, schoolId?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const inv = await tx.supplierInvoice.findFirst({
        where: { id: invoiceId, ...(schoolId ? { schoolId } : {}) },
        include: { lines: true },
      });
      if (!inv) throw new NotFoundException('Invoice not found');
      const credited = await tx.supplierCreditNoteLine.groupBy({
        by: ['invoiceLineId'],
        where: { invoiceLineId: { in: inv.lines.map((l) => l.id) } },
        _sum: { quantity: true },
      });
      const done = new Map(
        credited.map((c) => [c.invoiceLineId, Number(c._sum.quantity ?? 0)]),
      );
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        voided: inv.status === SupplierInvoiceStatus.VOID,
        remaining: fromCents(toCents(inv.total) - toCents(inv.creditAmount)),
        lines: inv.lines.map((l) => {
          const creditedQuantity = done.get(l.id) ?? 0;
          return {
            invoiceLineId: l.id,
            description: l.description,
            unitPrice: Number(l.unitPrice),
            taxRate: Number(l.taxRate),
            invoiced: Number(l.quantity),
            credited: creditedQuantity,
            available: creditableQuantity({
              quantity: Number(l.quantity),
              creditedQuantity,
            }),
            canRestock: l.variantId !== null,
          };
        }),
      };
    });
  }

  async create(dto: CreateCreditNoteDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const created = await this.tenantPrisma.run(async (tx) => {
      const first = await tx.supplierInvoice.findUnique({
        where: { id: dto.invoiceId },
        select: { schoolId: true },
      });
      if (!first) throw new NotFoundException('Invoice not found');
      // the same lock a payment takes, so a payment and a credit note on one school never run over each other
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'school-pay:' + first.schoolId}))`;
      const inv = await tx.supplierInvoice.findUniqueOrThrow({
        where: { id: dto.invoiceId },
        include: { lines: true, school: true },
      });
      if (inv.status === SupplierInvoiceStatus.VOID)
        throw new ConflictException(
          'This invoice was cancelled, so it cannot be credited.',
        );

      const credited = await tx.supplierCreditNoteLine.groupBy({
        by: ['invoiceLineId'],
        where: { invoiceLineId: { in: inv.lines.map((l) => l.id) } },
        _sum: { quantity: true },
      });
      const done = new Map(
        credited.map((c) => [c.invoiceLineId, Number(c._sum.quantity ?? 0)]),
      );
      const plan = planCreditNote(
        inv.lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxRate: Number(l.taxRate),
          creditedQuantity: done.get(l.id) ?? 0,
        })),
        dto.lines.map((l) => ({
          invoiceLineId: l.invoiceLineId,
          quantity: l.quantity,
          restock: l.restock,
        })),
        fromCents(toCents(inv.total) - toCents(inv.creditAmount)),
      );
      if (plan.problem) throw new BadRequestException(plan.problem);

      const restocking = plan.lines.filter((l) => l.restock > 0);
      if (restocking.length > 0) {
        if (!dto.branchId)
          throw new BadRequestException(
            'Choose the branch the returned goods go back into.',
          );
        const branch = await tx.branch.findUnique({
          where: { id: dto.branchId },
          select: { id: true },
        });
        if (!branch) throw new NotFoundException('Branch not found');
      }

      const creditNumber = await this.numbers.next(tx, organizationId, 'CN');
      const now = new Date();
      const cn = await tx.supplierCreditNote.create({
        data: {
          organizationId,
          schoolId: inv.schoolId,
          invoiceId: inv.id,
          creditNumber,
          issueDate: new Date(`${todayKey(now)}T00:00:00Z`),
          reason: dto.reason,
          note: dto.note?.trim() || null,
          subtotal: plan.subtotal,
          taxAmount: plan.taxAmount,
          total: plan.total,
          branchId: restocking.length > 0 ? dto.branchId : null,
          createdById: orgUserId,
          lines: {
            create: plan.lines.map((l) => ({
              invoiceLineId: l.invoiceLineId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
              lineTotal: l.lineTotal,
              taxAmount: l.taxAmount,
              quantityRestocked: l.restock,
            })),
          },
        },
        include,
      });

      // goods that came back go back on the shelf
      for (const l of restocking) {
        const invoiceLine = inv.lines.find((x) => x.id === l.invoiceLineId)!;
        if (!invoiceLine.variantId) continue;
        await this.inventory.recordInTx(tx, {
          branchId: dto.branchId!,
          variantId: invoiceLine.variantId,
          type: InventoryTxnType.RETURN,
          quantityDelta: l.restock,
          referenceId: cn.id,
        });
      }

      // the invoice now owes that much less
      const newCredit = fromCents(
        toCents(inv.creditAmount) + toCents(plan.total),
      );
      await tx.supplierInvoice.update({
        where: { id: inv.id },
        data: {
          creditAmount: newCredit,
          status: statusAfterSettlement(
            Number(inv.total),
            Number(inv.amountPaid) + Number(inv.writtenOffAmount),
            newCredit,
          ),
        },
      });

      // and the sale it was recorded as is refunded by the same amount (sales reports, profit and KRA follow)
      if (inv.saleId)
        await tx.refund.create({
          data: {
            saleId: inv.saleId,
            amount: plan.total,
            reason: `Credit note ${creditNumber}: ${REASON_WORDS[dto.reason]}`,
            approvedById: orgUserId,
            clientId: `school-credit-${cn.id}`,
          },
        });
      return cn;
    });

    const view = toCreditView(created);
    await this.tell(created, view);
    return view;
  }

  async list(schoolId?: string) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.supplierCreditNote.findMany({
        where: schoolId ? { schoolId } : {},
        include,
        orderBy: [{ issueDate: 'desc' }, { creditNumber: 'desc' }],
        take: 300,
      }),
    );
    return rows.map(toCreditView);
  }

  async get(id: string, schoolId?: string) {
    const row = await this.tenantPrisma.run((tx) =>
      tx.supplierCreditNote.findFirst({
        where: { id, ...(schoolId ? { schoolId } : {}) },
        include,
      }),
    );
    if (!row) throw new NotFoundException('Credit note not found');
    return toCreditView(row);
  }

  private async tell(cn: CreditFull, view: ReturnType<typeof toCreditView>) {
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
        name: cn.school.contactName ?? cn.school.name,
        phone: cn.school.phone,
        email: cn.school.email,
      },
      org?.name ?? 'Your supplier',
      `Credit note ${cn.creditNumber}`,
      `we have credited KES ${view.total.toFixed(2)} against invoice ${cn.invoice.invoiceNumber} (${view.reasonText.toLowerCase()}). This is credit note ${cn.creditNumber}. What you owe has gone down by that amount.`,
      {
        detailHtml: detailTable(
          ['Item', 'Qty', 'Amount'],
          view.lines.map((l) => [
            l.description,
            String(l.quantity),
            (l.lineTotal + l.taxAmount).toFixed(2),
          ]),
        ),
        link: slug
          ? { label: 'Open your account', url: `${base}/schools/${slug}` }
          : undefined,
      },
    );
  }
}
