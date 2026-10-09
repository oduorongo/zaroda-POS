import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommissionInvoice, CommissionInvoiceStatus, OnlineOrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { DEFAULT_COMMISSION_RATE } from './online-store.constants';
import {
  PAUSE_GRACE_DAYS,
  invoiceDueDate,
  invoiceNumber,
  isMonthClosed,
  isPastDue,
  isPauseOverdue,
  isValidMonth,
  monthBounds,
  monthOf,
  pauseDate,
  randomInvoiceCode,
  roundMoney,
} from './commission.util';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when the current tenant has an unpaid invoice past due date + grace.
 * Used by ShopCatalogService to hide the shop and refuse new orders -
 * deliberately worked out on every look (one indexed count), like
 * subscription status, so there's no scheduled job to keep a flag truthful.
 * Orders already placed carry on; only NEW checkouts are blocked.
 */
export async function hasOverdueCommission(tx: TenantTx, now: Date = new Date()): Promise<boolean> {
  const cutoff = new Date(now.getTime() - PAUSE_GRACE_DAYS * DAY_MS);
  const count = await tx.commissionInvoice.count({
    where: { status: CommissionInvoiceStatus.ISSUED, dueDate: { lt: cutoff } },
  });
  return count > 0;
}

export function toInvoiceView(invoice: CommissionInvoice, now: Date = new Date()) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    periodMonth: invoice.periodMonth,
    orderCount: invoice.orderCount,
    salesTotal: Number(invoice.salesTotal),
    commissionTotal: Number(invoice.commissionTotal),
    status: invoice.status,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    // The date the shop is hidden if this stays unpaid.
    pauseDate: pauseDate(invoice.dueDate),
    pastDue: isPastDue(invoice, now),
    causesPause: isPauseOverdue(invoice, now),
    paidAt: invoice.paidAt,
    paymentMethod: invoice.paymentMethod,
    paymentReference: invoice.paymentReference,
    waivedReason: invoice.waivedReason,
  };
}

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly sms: AfricasTalkingSmsProvider,
  ) {}

  private runAsTenant<T>(organizationId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  // ── The business's own view ───────────────────────────────────────────

  async getMine() {
    const { organizationId } = getTenantStore();
    const now = new Date();
    return this.tenantPrisma.run(async (tx) => {
      const [store, unbilled, invoices] = await Promise.all([
        tx.onlineStore.findUnique({ where: { organizationId }, select: { commissionRate: true } }),
        tx.onlineOrder.aggregate({
          where: { status: OnlineOrderStatus.COMPLETED, commissionInvoiceId: null },
          _count: true,
          _sum: { subtotal: true, commissionAmount: true },
        }),
        tx.commissionInvoice.findMany({ orderBy: { periodMonth: 'desc' }, take: 24 }),
      ]);
      const views = invoices.map((i) => toInvoiceView(i, now));
      return {
        commissionRate: store?.commissionRate != null ? Number(store.commissionRate) : DEFAULT_COMMISSION_RATE,
        // Completed orders not yet on an invoice - billed once their month closes.
        unbilled: {
          orderCount: unbilled._count,
          salesTotal: Number(unbilled._sum.subtotal ?? 0),
          commissionTotal: Number(unbilled._sum.commissionAmount ?? 0),
        },
        invoices: views,
        outstandingTotal: roundMoney(
          views.filter((v) => v.status === CommissionInvoiceStatus.ISSUED).reduce((sum, v) => sum + v.commissionTotal, 0),
        ),
        paused: views.some((v) => v.causesPause),
      };
    });
  }

  // ── Platform admin ────────────────────────────────────────────────────

  /**
   * Rolls each business's completed-but-unbilled orders into one invoice
   * per closed month. Safe to run as often as you like: an order is only
   * ever billed once (commissionInvoiceId), and a month that already has an
   * invoice is topped up only while that invoice is still unpaid.
   *
   * Loops organizations one at a time, in a transaction each - the same
   * documented pilot-scale pattern as PlatformAdminService (listing every
   * tenant's rows has no single query under per-tenant RLS).
   */
  async generateInvoices(opts: { month?: string } = {}) {
    if (opts.month !== undefined) {
      if (!isValidMonth(opts.month)) throw new BadRequestException('Month must look like 2026-10');
      if (!isMonthClosed(opts.month)) {
        throw new BadRequestException('That month has not ended yet - invoices can only be created once it has');
      }
    }
    const now = new Date();
    const currentMonthStart = monthBounds(monthOf(now)).start;
    const organizations = await this.prisma.organization.findMany({ select: { id: true, name: true } });

    const created: { organizationName: string; invoiceNumber: string; periodMonth: string; commissionTotal: number }[] = [];
    const toNotify: { organizationId: string; invoice: CommissionInvoice }[] = [];

    for (const org of organizations) {
      const invoices = await this.runAsTenant(org.id, async (tx) => {
        const orders = await tx.onlineOrder.findMany({
          where: {
            status: OnlineOrderStatus.COMPLETED,
            commissionInvoiceId: null,
            completedAt: { not: null, lt: currentMonthStart },
          },
          select: { id: true, subtotal: true, commissionAmount: true, completedAt: true },
        });
        const byMonth = new Map<string, typeof orders>();
        for (const order of orders) {
          const month = monthOf(order.completedAt!);
          if (opts.month && month !== opts.month) continue;
          byMonth.set(month, [...(byMonth.get(month) ?? []), order]);
        }

        const made: CommissionInvoice[] = [];
        for (const [month, monthOrders] of Array.from(byMonth.entries())) {
          const salesTotal = roundMoney(monthOrders.reduce((sum, o) => sum + Number(o.subtotal), 0));
          const commissionTotal = roundMoney(monthOrders.reduce((sum, o) => sum + Number(o.commissionAmount ?? 0), 0));
          const orderIds = monthOrders.map((o) => o.id);

          const existing = await tx.commissionInvoice.findUnique({
            where: { organizationId_periodMonth: { organizationId: org.id, periodMonth: month } },
          });
          if (existing) {
            if (existing.status !== CommissionInvoiceStatus.ISSUED) {
              this.logger.warn({ organizationId: org.id, month }, 'Completed orders found for a month whose invoice is already settled - left unbilled for review');
              continue;
            }
            await tx.onlineOrder.updateMany({ where: { id: { in: orderIds } }, data: { commissionInvoiceId: existing.id } });
            await tx.commissionInvoice.update({
              where: { id: existing.id },
              data: {
                orderCount: { increment: orderIds.length },
                salesTotal: { increment: salesTotal },
                commissionTotal: { increment: commissionTotal },
              },
            });
            continue;
          }

          const { start, end } = monthBounds(month);
          const issuedAt = new Date();
          let invoice: CommissionInvoice | undefined;
          for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
            try {
              invoice = await tx.commissionInvoice.create({
                data: {
                  organizationId: org.id,
                  invoiceNumber: invoiceNumber(month, randomInvoiceCode()),
                  periodMonth: month,
                  periodStart: start,
                  periodEnd: end,
                  orderCount: orderIds.length,
                  salesTotal,
                  commissionTotal,
                  issuedAt,
                  dueDate: invoiceDueDate(issuedAt),
                },
              });
            } catch (e) {
              // Only a number collision is worth retrying; anything else is real.
              const collision =
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === 'P2002' &&
                JSON.stringify(e.meta?.target ?? '').includes('invoiceNumber');
              if (!collision) throw e;
            }
          }
          if (!invoice) throw new ConflictException('Could not allocate an invoice number - try again');
          await tx.onlineOrder.updateMany({ where: { id: { in: orderIds } }, data: { commissionInvoiceId: invoice.id } });
          made.push(invoice);
        }
        return made;
      });

      for (const invoice of invoices) {
        created.push({
          organizationName: org.name,
          invoiceNumber: invoice.invoiceNumber,
          periodMonth: invoice.periodMonth,
          commissionTotal: Number(invoice.commissionTotal),
        });
        toNotify.push({ organizationId: org.id, invoice });
      }
    }

    // Texts go out after everything is saved - a failed SMS never undoes billing.
    for (const { organizationId, invoice } of toNotify) {
      await this.notifyIssued(organizationId, invoice);
    }
    return { created: created.length, invoices: created };
  }

  private async notifyIssued(organizationId: string, invoice: CommissionInvoice) {
    try {
      const store = await this.runAsTenant(organizationId, (tx) =>
        tx.onlineStore.findUnique({ where: { organizationId }, select: { contactPhone: true, displayName: true } }),
      );
      if (!store?.contactPhone) return;
      const digits = store.contactPhone.replace(/[\s\-()]/g, '').replace(/^\+/, '');
      const phone = /^(?:254|0)?([17]\d{8})$/.exec(digits);
      if (!phone) return;
      await this.sms.sendSms({
        to: `+254${phone[1]}`,
        message: `Zaroda: commission invoice ${invoice.invoiceNumber} for ${invoice.periodMonth} is KES ${Number(invoice.commissionTotal).toLocaleString('en-KE')}, due ${invoice.dueDate.toLocaleDateString('en-KE')}. Pay on time to keep your online shop open.`,
      });
    } catch (e) {
      this.logger.warn({ err: e, organizationId }, 'Could not send the commission invoice SMS');
    }
  }

  /** Every invoice, newest first - optionally one status, or one business. */
  async listInvoices(filter: { status?: CommissionInvoiceStatus; organizationId?: string } = {}) {
    const now = new Date();
    const organizations = await this.prisma.organization.findMany({
      where: filter.organizationId ? { id: filter.organizationId } : undefined,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const rows: (ReturnType<typeof toInvoiceView> & { organizationId: string; organizationName: string })[] = [];
    for (const org of organizations) {
      const invoices = await this.runAsTenant(org.id, (tx) =>
        tx.commissionInvoice.findMany({ where: filter.status ? { status: filter.status } : undefined, orderBy: { periodMonth: 'desc' } }),
      );
      for (const invoice of invoices) {
        rows.push({ ...toInvoiceView(invoice, now), organizationId: org.id, organizationName: org.name });
      }
    }
    return rows.sort((a, b) => b.periodMonth.localeCompare(a.periodMonth) || a.organizationName.localeCompare(b.organizationName));
  }

  private async loadIssuedInvoice(tx: TenantTx, invoiceId: string) {
    const invoice = await tx.commissionInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== CommissionInvoiceStatus.ISSUED) {
      throw new ConflictException(`This invoice is already ${invoice.status.toLowerCase()}`);
    }
    return invoice;
  }

  async recordPayment(
    organizationId: string,
    invoiceId: string,
    dto: { method: string; reference?: string },
    platformAdminId: string,
  ) {
    const invoice = await this.runAsTenant(organizationId, async (tx) => {
      await this.loadIssuedInvoice(tx, invoiceId);
      // Conditional on still being ISSUED, so two admins recording at once can't both succeed.
      const result = await tx.commissionInvoice.updateMany({
        where: { id: invoiceId, status: CommissionInvoiceStatus.ISSUED },
        data: {
          status: CommissionInvoiceStatus.PAID,
          paidAt: new Date(),
          paymentMethod: dto.method,
          paymentReference: dto.reference?.trim() || null,
          recordedByPlatformAdminId: platformAdminId,
        },
      });
      if (result.count === 0) throw new ConflictException('This invoice was just updated by someone else - refresh');
      return tx.commissionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
    return toInvoiceView(invoice);
  }

  async waive(organizationId: string, invoiceId: string, reason: string, platformAdminId: string) {
    const invoice = await this.runAsTenant(organizationId, async (tx) => {
      await this.loadIssuedInvoice(tx, invoiceId);
      const result = await tx.commissionInvoice.updateMany({
        where: { id: invoiceId, status: CommissionInvoiceStatus.ISSUED },
        data: {
          status: CommissionInvoiceStatus.WAIVED,
          waivedReason: reason.trim(),
          recordedByPlatformAdminId: platformAdminId,
        },
      });
      if (result.count === 0) throw new ConflictException('This invoice was just updated by someone else - refresh');
      return tx.commissionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
    return toInvoiceView(invoice);
  }
}
