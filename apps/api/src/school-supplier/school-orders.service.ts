import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryTxnType,
  Prisma,
  SchoolOrderStatus,
  SchoolStatus,
} from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { variantTitle } from '../catalog/variant-title';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import {
  CancelOrderDto,
  ConfirmOrderDto,
  DeliverOrderDto,
  SubmitSchoolOrderDto,
} from './dto/school-supplier.dto';
import { DocumentNumbersService } from './document-numbers.service';
import { SchoolLedgerService } from './school-ledger.service';
import { SchoolNotifierService } from './school-notifier.service';
import {
  addDays,
  documentTotals,
  exceedsCreditLimit,
  lineAmounts,
  todayKey,
} from './school-money.util';

type OrderWithLines = Prisma.SchoolOrderGetPayload<{
  include: {
    lines: true;
    school: {
      select: {
        id: true;
        name: true;
        phone: true;
        email: true;
        contactName: true;
      };
    };
    invoice: { select: { id: true; invoiceNumber: true; total: true } };
  };
}>;

const include = {
  lines: { orderBy: { productName: 'asc' as const } },
  school: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      contactName: true,
    },
  },
  invoice: { select: { id: true, invoiceNumber: true, total: true } },
};

/** What a line counts for right now: what was delivered, else what was confirmed, else what was asked for. */
const basisQty = (l: {
  quantityOrdered: unknown;
  quantityConfirmed: unknown;
  quantityDelivered: unknown;
}) => Number(l.quantityDelivered ?? l.quantityConfirmed ?? l.quantityOrdered);

export function toOrderView(o: OrderWithLines) {
  const lines = o.lines.map((l) => {
    const quantity = basisQty(l);
    const amounts = lineAmounts({
      quantity,
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
    });
    return {
      id: l.id,
      variantId: l.variantId,
      title: l.productName,
      sku: l.variantSku,
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
      quantityOrdered: Number(l.quantityOrdered),
      quantityConfirmed:
        l.quantityConfirmed === null ? null : Number(l.quantityConfirmed),
      quantityDelivered:
        l.quantityDelivered === null ? null : Number(l.quantityDelivered),
      lineTotal: amounts.lineTotal,
      taxAmount: amounts.taxAmount,
    };
  });
  const totals = documentTotals(
    o.lines.map((l) => ({
      quantity: basisQty(l),
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
    })),
  );
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    lpoNumber: o.lpoNumber,
    status: o.status,
    school: o.school,
    notes: o.notes,
    deliveryAddress: o.deliveryAddress,
    requestedDate: o.requestedDate
      ? o.requestedDate.toISOString().slice(0, 10)
      : null,
    overCreditLimit: o.overCreditLimit,
    submittedAt: o.submittedAt,
    confirmedAt: o.confirmedAt,
    confirmationNote: o.confirmationNote,
    deliveredAt: o.deliveredAt,
    deliveryNoteNumber: o.deliveryNoteNumber,
    receivedByName: o.receivedByName,
    deliveryNotes: o.deliveryNotes,
    cancelledAt: o.cancelledAt,
    cancelledBy: o.cancelledBy,
    cancelReason: o.cancelReason,
    invoice: o.invoice
      ? {
          id: o.invoice.id,
          invoiceNumber: o.invoice.invoiceNumber,
          total: Number(o.invoice.total),
        }
      : null,
    lines,
    ...totals,
  };
}

/** An order's life: the school submits, the supplier confirms (maybe with fewer), the goods go out with a delivery note and an invoice. */
@Injectable()
export class SchoolOrdersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
    private readonly numbers: DocumentNumbersService,
    private readonly ledger: SchoolLedgerService,
    private readonly notifier: SchoolNotifierService,
  ) {}

  // ── The school's side ──────────────────────────────────────────────────

  /** Places an order for a school. Prices come from the price list now and are written down on the order. */
  async submit(schoolId: string, dto: SubmitSchoolOrderDto) {
    const { organizationId } = getTenantStore();
    const merged = new Map<string, number>();
    for (const l of dto.lines)
      merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.quantity);

    const order = await this.tenantPrisma.run(async (tx) => {
      const school = await tx.supplierSchool.findUnique({
        where: { id: schoolId },
      });
      if (!school || school.status !== SchoolStatus.ACTIVE)
        throw new BadRequestException(
          'This school account is not active. Please contact the supplier.',
        );

      const variants = await tx.productVariant.findMany({
        where: { id: { in: Array.from(merged.keys()) }, onSchoolList: true, product: { isActive: true } },
        include: {
          product: {
            select: {
              name: true,
              taxClass: { select: { rate: true, isExempt: true } },
            },
          },
        },
      });
      if (variants.length !== merged.size)
        throw new BadRequestException(
          'One of the items is no longer on the price list. Please refresh and try again.',
        );

      const priced = variants.map((v) => {
        const quantity = merged.get(v.id)!;
        const tc = v.product.taxClass;
        return {
          variantId: v.id,
          productName: variantTitle(v.product.name, v.name),
          variantSku: v.sku,
          unitPrice: Number(v.schoolPrice ?? v.price),
          taxRate: tc && !tc.isExempt ? Number(tc.rate) : 0,
          quantity,
        };
      });
      const total = documentTotals(priced).total;
      const balance = (await this.ledger.balances(tx, [schoolId])).get(
        schoolId,
      );
      const over = exceedsCreditLimit(
        school.creditLimit === null ? null : Number(school.creditLimit),
        balance?.owed ?? 0,
        total,
      );

      const orderNumber = await this.numbers.next(tx, organizationId, 'SO');
      return tx.schoolOrder.create({
        data: {
          organizationId,
          schoolId,
          orderNumber,
          lpoNumber: dto.lpoNumber?.trim() || null,
          notes: dto.notes?.trim() || null,
          deliveryAddress: dto.deliveryAddress?.trim() || school.address,
          requestedDate: dto.requestedDate
            ? new Date(`${dto.requestedDate}T00:00:00Z`)
            : null,
          overCreditLimit: over,
          lines: {
            create: priced.map((p) => ({
              variantId: p.variantId,
              productName: p.productName,
              variantSku: p.variantSku,
              unitPrice: p.unitPrice,
              taxRate: p.taxRate,
              quantityOrdered: p.quantity,
            })),
          },
        },
        include,
      });
    });
    return toOrderView(order);
  }

  /** The school withdraws an order that the supplier has not yet confirmed. */
  async cancelBySchool(schoolId: string, orderId: string, reason?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const res = await tx.schoolOrder.updateMany({
        where: { id: orderId, schoolId, status: SchoolOrderStatus.SUBMITTED },
        data: {
          status: SchoolOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: 'SCHOOL',
          cancelReason: reason?.trim() || 'Cancelled by the school',
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'This order can no longer be cancelled - it has already been confirmed or closed. Please call the supplier.',
        );
      return toOrderView(
        await tx.schoolOrder.findUniqueOrThrow({
          where: { id: orderId },
          include,
        }),
      );
    });
  }

  async listForSchool(schoolId: string) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.schoolOrder.findMany({
        where: { schoolId },
        include,
        orderBy: { submittedAt: 'desc' },
        take: 200,
      }),
    );
    return rows.map(toOrderView);
  }

  async getForSchool(schoolId: string, orderId: string) {
    const row = await this.tenantPrisma.run((tx) =>
      tx.schoolOrder.findFirst({ where: { id: orderId, schoolId }, include }),
    );
    if (!row) throw new NotFoundException('Order not found');
    return toOrderView(row);
  }

  // ── The supplier's side ────────────────────────────────────────────────

  async list(status?: string, schoolId?: string) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.schoolOrder.findMany({
        where: {
          ...(status ? { status: status as SchoolOrderStatus } : {}),
          ...(schoolId ? { schoolId } : {}),
        },
        include,
        orderBy: { submittedAt: 'desc' },
        take: 300,
      }),
    );
    return rows.map(toOrderView);
  }

  async get(id: string) {
    const row = await this.tenantPrisma.run((tx) =>
      tx.schoolOrder.findUnique({ where: { id }, include }),
    );
    if (!row) throw new NotFoundException('Order not found');
    return toOrderView(row);
  }

  /** Accepts the order, optionally supplying less than was asked (0 = cannot supply that line). The school is told. */
  async confirm(id: string, dto: ConfirmOrderDto) {
    const order = await this.tenantPrisma.run(async (tx) => {
      const current = await tx.schoolOrder.findUnique({
        where: { id },
        include,
      });
      if (!current) throw new NotFoundException('Order not found');
      if (current.status !== SchoolOrderStatus.SUBMITTED)
        throw new ConflictException('Only a new order can be confirmed');

      const chosen = new Map(
        (dto.lines ?? []).map((l) => [l.lineId, l.quantity]),
      );
      for (const lineId of Array.from(chosen.keys())) {
        if (!current.lines.some((l) => l.id === lineId))
          throw new BadRequestException(
            'One of the lines is not part of this order',
          );
      }
      let anything = false;
      for (const l of current.lines) {
        const qty = chosen.has(l.id)
          ? chosen.get(l.id)!
          : Number(l.quantityOrdered);
        if (qty > Number(l.quantityOrdered))
          throw new BadRequestException(
            `${l.productName}: you cannot confirm more than the school ordered`,
          );
        if (qty > 0) anything = true;
        await tx.schoolOrderLine.update({
          where: { id: l.id },
          data: { quantityConfirmed: qty },
        });
      }
      if (!anything)
        throw new BadRequestException(
          'Nothing is left to supply - cancel the order instead',
        );

      const res = await tx.schoolOrder.updateMany({
        where: { id, status: SchoolOrderStatus.SUBMITTED },
        data: {
          status: SchoolOrderStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmationNote: dto.note?.trim() || null,
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'This order was just changed by someone else',
        );
      return tx.schoolOrder.findUniqueOrThrow({ where: { id }, include });
    });
    const view = toOrderView(order);
    await this.tell(
      order,
      `Order ${order.orderNumber} confirmed`,
      `your order ${order.orderNumber}${order.lpoNumber ? ` (LPO ${order.lpoNumber})` : ''} is confirmed${view.lines.some((l) => (l.quantityConfirmed ?? 0) < l.quantityOrdered) ? ', with some quantities changed - open the portal to see' : ''}. Total KES ${view.total.toFixed(2)}. We will deliver with a delivery note and invoice.`,
    );
    return view;
  }

  async cancel(id: string, dto: CancelOrderDto) {
    const order = await this.tenantPrisma.run(async (tx) => {
      const res = await tx.schoolOrder.updateMany({
        where: {
          id,
          status: {
            in: [SchoolOrderStatus.SUBMITTED, SchoolOrderStatus.CONFIRMED],
          },
        },
        data: {
          status: SchoolOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: 'SUPPLIER',
          cancelReason: dto.reason.trim(),
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'This order cannot be cancelled - it is already delivered or cancelled',
        );
      return tx.schoolOrder.findUniqueOrThrow({ where: { id }, include });
    });
    await this.tell(
      order,
      `Order ${order.orderNumber} cancelled`,
      `your order ${order.orderNumber} was cancelled by the supplier. Reason: ${dto.reason.trim()}`,
    );
    return toOrderView(order);
  }

  /**
   * The goods go out: stock comes down, the order gets its delivery note number and an invoice is raised for exactly what was
   * delivered, due after the school's credit days. All in one transaction - either every step happens or none does.
   */
  async deliver(id: string, dto: DeliverOrderDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const order = await this.tenantPrisma.run(async (tx) => {
      const current = await tx.schoolOrder.findUnique({
        where: { id },
        include: { lines: true, school: true },
      });
      if (!current) throw new NotFoundException('Order not found');
      if (current.status !== SchoolOrderStatus.CONFIRMED)
        throw new ConflictException('Only a confirmed order can be delivered');

      const chosen = new Map(
        (dto.lines ?? []).map((l) => [l.lineId, l.quantity]),
      );
      for (const lineId of Array.from(chosen.keys())) {
        if (!current.lines.some((l) => l.id === lineId))
          throw new BadRequestException(
            'One of the lines is not part of this order',
          );
      }

      // Claim the order first: the status flip is what stops two people delivering it twice.
      const claim = await tx.schoolOrder.updateMany({
        where: { id, status: SchoolOrderStatus.CONFIRMED },
        data: { status: SchoolOrderStatus.DELIVERED },
      });
      if (claim.count === 0)
        throw new ConflictException(
          'This order was just delivered by someone else',
        );

      const delivered: {
        line: (typeof current.lines)[number];
        quantity: number;
        cost: number | null;
      }[] = [];
      for (const l of current.lines) {
        const confirmed = Number(l.quantityConfirmed ?? l.quantityOrdered);
        const qty = chosen.has(l.id) ? chosen.get(l.id)! : confirmed;
        if (qty > confirmed)
          throw new BadRequestException(
            `${l.productName}: you cannot deliver more than was confirmed (${confirmed})`,
          );
        await tx.schoolOrderLine.update({
          where: { id: l.id },
          data: { quantityDelivered: qty },
        });
        if (qty <= 0) continue;

        const stock = await tx.inventoryItem.findUnique({
          where: {
            branchId_variantId: {
              branchId: dto.branchId,
              variantId: l.variantId,
            },
          },
        });
        if (Number(stock?.quantity ?? 0) < qty) {
          throw new BadRequestException(
            `Not enough stock of ${l.productName}: ${Number(stock?.quantity ?? 0)} in stock, ${qty} to deliver`,
          );
        }
        await this.inventory.recordInTx(tx, {
          branchId: dto.branchId,
          variantId: l.variantId,
          type: InventoryTxnType.CREDIT_SALE,
          quantityDelta: -qty,
          referenceId: id,
        });
        const variant = await tx.productVariant.findUnique({
          where: { id: l.variantId },
          select: { cost: true },
        });
        delivered.push({
          line: l,
          quantity: qty,
          cost:
            variant?.cost === null || variant === null
              ? null
              : Number(variant.cost),
        });
      }
      if (delivered.length === 0)
        throw new BadRequestException('Nothing to deliver');

      const now = new Date();
      const today = todayKey(now);
      const deliveryNoteNumber = await this.numbers.next(
        tx,
        organizationId,
        'DN',
        now,
      );
      const invoiceNumber = await this.numbers.next(
        tx,
        organizationId,
        'INV',
        now,
      );
      const totals = documentTotals(
        delivered.map((d) => ({
          quantity: d.quantity,
          unitPrice: Number(d.line.unitPrice),
          taxRate: Number(d.line.taxRate),
        })),
      );

      await tx.supplierInvoice.create({
        data: {
          organizationId,
          schoolId: current.schoolId,
          orderId: id,
          invoiceNumber,
          issueDate: new Date(`${today}T00:00:00Z`),
          dueDate: new Date(
            `${addDays(today, current.school.creditDays)}T00:00:00Z`,
          ),
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          total: totals.total,
          createdById: orgUserId,
          lines: {
            create: delivered.map((d) => {
              const a = lineAmounts({
                quantity: d.quantity,
                unitPrice: Number(d.line.unitPrice),
                taxRate: Number(d.line.taxRate),
              });
              return {
                variantId: d.line.variantId,
                description: d.line.productName,
                quantity: d.quantity,
                unitPrice: d.line.unitPrice,
                taxRate: d.line.taxRate,
                lineTotal: a.lineTotal,
                taxAmount: a.taxAmount,
                unitCost: d.cost,
              };
            }),
          },
        },
      });
      await tx.schoolOrder.update({
        where: { id },
        data: {
          deliveredAt: now,
          deliveryNoteNumber,
          receivedByName: dto.receivedByName.trim(),
          deliveryNotes: dto.notes?.trim() || null,
          deliveredById: orgUserId,
        },
      });
      return tx.schoolOrder.findUniqueOrThrow({ where: { id }, include });
    });
    const view = toOrderView(order);
    await this.tell(
      order,
      `Delivery ${order.deliveryNoteNumber}`,
      `your order ${order.orderNumber} was delivered (delivery note ${order.deliveryNoteNumber}). Invoice ${order.invoice?.invoiceNumber} for KES ${view.total.toFixed(2)} is in the portal.`,
    );
    return view;
  }

  /** Orders waiting for the supplier to confirm - for the dashboard and alerts. */
  async pendingCount(): Promise<number> {
    return this.tenantPrisma.run((tx) =>
      tx.schoolOrder.count({ where: { status: SchoolOrderStatus.SUBMITTED } }),
    );
  }

  private async tell(order: OrderWithLines, subject: string, message: string) {
    const { organizationId } = getTenantStore();
    const org = await this.tenantPrisma.run((tx) =>
      tx.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
    );
    await this.notifier.notify(
      {
        name: order.school.contactName ?? order.school.name,
        phone: order.school.phone,
        email: order.school.email,
      },
      org?.name ?? 'Your supplier',
      subject,
      message,
    );
  }
}
