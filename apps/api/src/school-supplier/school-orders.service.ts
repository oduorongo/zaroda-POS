import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  InventoryTxnType,
  Prisma,
  Role,
  SchoolOrderStatus,
  SchoolStatus,
} from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { variantTitle } from '../catalog/variant-title';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import {
  CancelOrderDto,
  CloseBalanceDto,
  ConfirmOrderDto,
  ConfirmReceiptDto,
  DeliverOrderDto,
  SubmitSchoolOrderDto,
} from './dto/school-supplier.dto';
import { DocumentNumbersService } from './document-numbers.service';
import {
  balanceOf,
  noteLine,
  planDelivery,
  statusAfterDelivery,
} from './school-delivery.util';
import { SchoolLedgerService } from './school-ledger.service';
import { detailTable, SchoolNotifierService } from './school-notifier.service';
import {
  addDays,
  documentTotals,
  exceedsCreditLimit,
  lineAmounts,
  todayKey,
} from './school-money.util';
import { recordSchoolSale } from './school-sale';

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
  deliveries: {
    orderBy: { sequence: 'asc' as const },
    include: {
      lines: true,
      invoice: { select: { id: true, invoiceNumber: true, total: true } },
    },
  },
} satisfies Prisma.SchoolOrderInclude;
type OrderWithLines = Prisma.SchoolOrderGetPayload<{ include: typeof include }>;

/** What the supplier agreed to supply on a line: the quantity confirmed, or what was asked for if nothing was changed. */
const agreedQty = (l: {
  quantityOrdered: unknown;
  quantityConfirmed: unknown;
}) => Number(l.quantityConfirmed ?? l.quantityOrdered);

const OPEN_FOR_DELIVERY: SchoolOrderStatus[] = [
  SchoolOrderStatus.CONFIRMED,
  SchoolOrderStatus.PARTIALLY_DELIVERED,
];

export function toOrderView(o: OrderWithLines) {
  const open = OPEN_FOR_DELIVERY.includes(o.status);
  const lines = o.lines.map((l) => {
    const agreed = agreedQty(l);
    const delivered = Number(l.quantityDelivered ?? 0);
    const amounts = lineAmounts({
      quantity: agreed,
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
      /** Everything delivered so far. */
      quantityDelivered: delivered,
      /** Still to come (only while the order is open for delivery). */
      balance: open ? balanceOf({ agreed, delivered }) : 0,
      lineTotal: amounts.lineTotal,
      taxAmount: amounts.taxAmount,
    };
  });
  const totals = documentTotals(
    o.lines.map((l) => ({
      quantity: agreedQty(l),
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
    })),
  );
  const byLine = new Map(o.lines.map((l) => [l.id, l]));
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
    balanceClosedAt: o.balanceClosedAt,
    balanceClosedNote: o.balanceClosedNote,
    cancelledAt: o.cancelledAt,
    cancelledBy: o.cancelledBy,
    cancelReason: o.cancelReason,
    /** True while some of what was agreed has not been delivered. */
    hasBalance: open && lines.some((l) => l.balance > 0),
    /** Each drop of goods: its own delivery note and its own invoice. */
    deliveries: o.deliveries.map((d) => ({
      id: d.id,
      sequence: d.sequence,
      deliveryNoteNumber: d.deliveryNoteNumber,
      deliveredAt: d.deliveredAt,
      receivedByName: d.receivedByName,
      notes: d.notes,
      schoolConfirmedAt: d.schoolConfirmedAt,
      schoolConfirmedBy: d.schoolConfirmedBy,
      schoolConfirmNote: d.schoolConfirmNote,
      invoice: d.invoice
        ? {
            id: d.invoice.id,
            invoiceNumber: d.invoice.invoiceNumber,
            total: Number(d.invoice.total),
          }
        : null,
      lines: d.lines.map((dl) => ({
        lineId: dl.orderLineId,
        title: byLine.get(dl.orderLineId)?.productName ?? '',
        quantity: Number(dl.quantity),
      })),
    })),
    lines,
    ...totals,
  };
}

/**
 * An order's life: the school submits, the supplier confirms (maybe with fewer), and the goods go out in one or more
 * deliveries - each with its own delivery note and its own invoice, and recorded as a sale. What is not yet delivered stays
 * on the order as a balance, visible to both sides, until it is delivered or the supplier closes the order without it.
 */
@Injectable()
export class SchoolOrdersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
    private readonly numbers: DocumentNumbersService,
    private readonly ledger: SchoolLedgerService,
    private readonly notifier: SchoolNotifierService,
    private readonly config: ConfigService,
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
        where: {
          id: { in: Array.from(merged.keys()) },
          onSchoolList: true,
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
    const view = toOrderView(order);
    await this.tellStaff(
      `New school order ${order.orderNumber} from ${order.school.name}`,
      `${order.school.name} has placed order ${order.orderNumber}${order.lpoNumber ? ` (LPO ${order.lpoNumber})` : ''} for KES ${view.total.toFixed(2)}${order.overCreditLimit ? ' - this takes them over their credit limit' : ''}. Open School orders to confirm it.`,
      detailTable(
        ['Item', 'Qty', 'Amount'],
        view.lines.map((l) => [
          l.title,
          String(l.quantityOrdered),
          (l.unitPrice * l.quantityOrdered).toFixed(2),
        ]),
      ),
    );
    return view;
  }

  /** The school withdraws an order that the supplier has not yet confirmed. */
  async cancelBySchool(schoolId: string, orderId: string, reason?: string) {
    const order = await this.tenantPrisma.run(async (tx) => {
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
      return tx.schoolOrder.findUniqueOrThrow({
        where: { id: orderId },
        include,
      });
    });
    await this.tellStaff(
      `${order.school.name} cancelled order ${order.orderNumber}`,
      `${order.school.name} withdrew order ${order.orderNumber}. Reason: ${order.cancelReason}.`,
    );
    return toOrderView(order);
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

  /** The school says the goods of one delivery arrived. The supplier is told, and sees it on the order. */
  async confirmReceived(
    schoolId: string,
    deliveryId: string,
    dto: ConfirmReceiptDto,
  ) {
    const delivery = await this.tenantPrisma.run(async (tx) => {
      const d = await tx.schoolDelivery.findFirst({
        where: { id: deliveryId, order: { schoolId } },
      });
      if (!d) throw new NotFoundException('Delivery not found');
      if (d.schoolConfirmedAt)
        throw new ConflictException('You have already confirmed this delivery.');
      await tx.schoolDelivery.update({
        where: { id: deliveryId },
        data: {
          schoolConfirmedAt: new Date(),
          schoolConfirmedBy: dto.name.trim(),
          schoolConfirmNote: dto.note?.trim() || null,
        },
      });
      return d;
    });
    const order = await this.tenantPrisma.run((tx) =>
      tx.schoolOrder.findUniqueOrThrow({
        where: { id: delivery.orderId },
        include,
      }),
    );
    await this.tellStaff(
      `${order.school.name} received delivery ${delivery.deliveryNoteNumber}`,
      `${dto.name.trim()} at ${order.school.name} confirmed that the goods on delivery note ${delivery.deliveryNoteNumber} (order ${order.orderNumber}) were received${dto.note?.trim() ? `. Their note: ${dto.note.trim()}` : '.'}`,
    );
    return toOrderView(order);
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
      detailTable(
        ['Item', 'Ordered', 'We will supply'],
        view.lines.map((l) => [
          l.title,
          String(l.quantityOrdered),
          String(l.quantityConfirmed ?? l.quantityOrdered),
        ]),
      ),
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
          'This order cannot be cancelled - it is already delivered, partly delivered or cancelled. If some goods have gone out, close the balance instead.',
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
   * One delivery: stock comes down for what goes out now, the delivery gets its own delivery note, an invoice is raised for
   * exactly this delivery (due after the school's credit days) and recorded as a sale. What is not delivered stays as the
   * order's balance, to be delivered later. All in one transaction - either every step happens or none does.
   */
  async deliver(id: string, dto: DeliverOrderDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const { order, deliveryId } = await this.tenantPrisma.run(async (tx) => {
      // One delivery at a time per order, so two people cannot deliver the same balance twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'school-order:' + id}))`;
      const current = await tx.schoolOrder.findUnique({
        where: { id },
        include: { lines: true, school: true, deliveries: true },
      });
      if (!current) throw new NotFoundException('Order not found');
      if (!OPEN_FOR_DELIVERY.includes(current.status))
        throw new ConflictException(
          'Only a confirmed order, or one with a balance still to deliver, can be delivered',
        );

      const chosen = new Map(
        (dto.lines ?? []).map((l) => [l.lineId, l.quantity]),
      );
      for (const lineId of Array.from(chosen.keys())) {
        if (!current.lines.some((l) => l.id === lineId))
          throw new BadRequestException(
            'One of the lines is not part of this order',
          );
      }
      const plan = planDelivery(
        current.lines.map((l) => ({
          id: l.id,
          title: l.productName,
          agreed: agreedQty(l),
          delivered: Number(l.quantityDelivered ?? 0),
        })),
        chosen,
      );
      if (plan.problem) throw new BadRequestException(plan.problem);

      const delivered: {
        line: (typeof current.lines)[number];
        quantity: number;
        cost: number | null;
      }[] = [];
      const newDeliveryId = randomUUID();
      for (const l of current.lines) {
        const qty = plan.quantities.get(l.id) ?? 0;
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
          referenceId: newDeliveryId,
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
      const sequence =
        current.deliveries.reduce((m, d) => Math.max(m, d.sequence), 0) + 1;

      await tx.schoolDelivery.create({
        data: {
          id: newDeliveryId,
          organizationId,
          orderId: id,
          sequence,
          deliveryNoteNumber,
          deliveredAt: now,
          branchId: dto.branchId,
          receivedByName: dto.receivedByName.trim(),
          notes: dto.notes?.trim() || null,
          deliveredById: orgUserId,
          lines: {
            create: delivered.map((d) => ({
              orderLineId: d.line.id,
              quantity: d.quantity,
            })),
          },
        },
      });
      const invoiceLines = delivered.map((d) => ({
        d,
        amounts: lineAmounts({
          quantity: d.quantity,
          unitPrice: Number(d.line.unitPrice),
          taxRate: Number(d.line.taxRate),
        }),
      }));
      const invoice = await tx.supplierInvoice.create({
        data: {
          organizationId,
          schoolId: current.schoolId,
          orderId: id,
          deliveryId: newDeliveryId,
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
            create: invoiceLines.map(({ d, amounts }) => ({
              variantId: d.line.variantId,
              description: d.line.productName,
              quantity: d.quantity,
              unitPrice: d.line.unitPrice,
              taxRate: d.line.taxRate,
              lineTotal: amounts.lineTotal,
              taxAmount: amounts.taxAmount,
              unitCost: d.cost,
            })),
          },
        },
      });
      // It is also a sale, so it shows in Sales and the reports like every other sale.
      const saleId = await recordSchoolSale(tx, {
        organizationId,
        orgUserId,
        branchId: dto.branchId,
        invoiceId: invoice.id,
        total: totals.total,
        lines: invoiceLines.map(({ d, amounts }) => ({
          variantId: d.line.variantId,
          quantity: d.quantity,
          unitPrice: Number(d.line.unitPrice),
          taxAmount: amounts.taxAmount,
        })),
      });
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: { saleId },
      });

      // What has gone out so far, line by line, and where the order stands now
      const after = current.lines.map((l) => ({
        line: l,
        agreed: agreedQty(l),
        delivered:
          Number(l.quantityDelivered ?? 0) + (plan.quantities.get(l.id) ?? 0),
      }));
      for (const a of after) {
        if ((plan.quantities.get(a.line.id) ?? 0) > 0)
          await tx.schoolOrderLine.update({
            where: { id: a.line.id },
            data: { quantityDelivered: a.delivered },
          });
      }
      const status = statusAfterDelivery(after);
      await tx.schoolOrder.update({
        where: { id },
        data: {
          status,
          ...(status === SchoolOrderStatus.DELIVERED
            ? { deliveredAt: now }
            : {}),
          receivedByName: dto.receivedByName.trim(),
          deliveredById: orgUserId,
        },
      });
      return {
        order: await tx.schoolOrder.findUniqueOrThrow({
          where: { id },
          include,
        }),
        deliveryId: newDeliveryId,
      };
    });
    const view = toOrderView(order);
    const d = view.deliveries.find((x) => x.id === deliveryId)!;
    const left = view.lines.filter((l) => l.balance > 0);
    await this.tell(
      order,
      `Delivery ${d.deliveryNoteNumber}`,
      `your order ${order.orderNumber} was delivered (delivery note ${d.deliveryNoteNumber}). Invoice ${d.invoice?.invoiceNumber} for KES ${(d.invoice?.total ?? 0).toFixed(2)} is in the portal.${left.length > 0 ? ` ${left.length} item${left.length === 1 ? ' is' : 's are'} still to come.` : ' The order is complete.'}`,
      detailTable(
        ['Item', 'Delivered now', 'Still to come'],
        d.lines.map((dl) => [
          dl.title,
          String(dl.quantity),
          String(view.lines.find((l) => l.id === dl.lineId)?.balance ?? 0),
        ]),
      ),
    );
    return view;
  }

  /** The supplier stops waiting to deliver the rest: the order is closed at what was delivered, and the school is told. */
  async closeBalance(id: string, dto: CloseBalanceDto) {
    const order = await this.tenantPrisma.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'school-order:' + id}))`;
      const current = await tx.schoolOrder.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!current) throw new NotFoundException('Order not found');
      if (current.status !== SchoolOrderStatus.PARTIALLY_DELIVERED)
        throw new ConflictException(
          'Only an order that has been partly delivered can be closed this way',
        );
      // the agreement now reads what was delivered, so the order's totals match the invoices
      for (const l of current.lines)
        await tx.schoolOrderLine.update({
          where: { id: l.id },
          data: { quantityConfirmed: Number(l.quantityDelivered ?? 0) },
        });
      await tx.schoolOrder.update({
        where: { id },
        data: {
          status: SchoolOrderStatus.DELIVERED,
          deliveredAt: new Date(),
          balanceClosedAt: new Date(),
          balanceClosedNote: dto.note.trim(),
        },
      });
      return tx.schoolOrder.findUniqueOrThrow({ where: { id }, include });
    });
    await this.tell(
      order,
      `Order ${order.orderNumber} closed`,
      `order ${order.orderNumber} is closed with what has been delivered. The rest will not be supplied. Reason: ${dto.note.trim()}`,
    );
    return toOrderView(order);
  }

  /** A delivery note's content: this drop, and how the order stands (ordered, delivered before, delivered now, still to come). */
  async deliveryNote(deliveryId: string, schoolId?: string) {
    const d = await this.tenantPrisma.run((tx) =>
      tx.schoolDelivery.findFirst({
        where: { id: deliveryId, ...(schoolId ? { order: { schoolId } } : {}) },
        include: {
          lines: true,
          invoice: { select: { invoiceNumber: true } },
          order: {
            include: {
              lines: { orderBy: { productName: 'asc' } },
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
              deliveries: { include: { lines: true } },
            },
          },
        },
      }),
    );
    if (!d) throw new NotFoundException('Delivery note not found');
    const o = d.order;
    const qtyIn = (
      deliveries: { sequence: number; lines: { orderLineId: string; quantity: unknown }[] }[],
      lineId: string,
    ) =>
      deliveries.reduce(
        (sum, x) =>
          sum +
          x.lines
            .filter((l) => l.orderLineId === lineId)
            .reduce((s, l) => s + Number(l.quantity), 0),
        0,
      );
    return {
      deliveryNoteNumber: d.deliveryNoteNumber,
      sequence: d.sequence,
      deliveredAt: d.deliveredAt.toISOString(),
      receivedByName: d.receivedByName,
      notes: d.notes,
      schoolConfirmedAt: d.schoolConfirmedAt
        ? d.schoolConfirmedAt.toISOString()
        : null,
      schoolConfirmedBy: d.schoolConfirmedBy,
      orderNumber: o.orderNumber,
      lpoNumber: o.lpoNumber,
      deliveryAddress: o.deliveryAddress,
      school: o.school,
      invoice: d.invoice ? { invoiceNumber: d.invoice.invoiceNumber } : null,
      lines: o.lines.map((l) => ({
        id: l.id,
        title: l.productName,
        sku: l.variantSku,
        ...noteLine({
          ordered: Number(l.quantityOrdered),
          agreed: agreedQty(l),
          before: qtyIn(
            o.deliveries.filter((x) => x.sequence < d.sequence),
            l.id,
          ),
          now: qtyIn([d], l.id),
        }),
      })),
    };
  }

  /**
   * What is in stock at one branch for each line of an order, so the supplier sees what can go out now and what is short
   * before pressing Deliver (a delivery cannot take more than is in stock).
   */
  async stockFor(id: string, branchId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const order = await tx.schoolOrder.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      const items = await tx.inventoryItem.findMany({
        where: {
          branchId,
          variantId: { in: order.lines.map((l) => l.variantId) },
        },
        select: { variantId: true, quantity: true },
      });
      const have = new Map(items.map((i) => [i.variantId, Number(i.quantity)]));
      return {
        branchId,
        lines: order.lines.map((l) => ({
          lineId: l.id,
          available: Math.max(0, have.get(l.variantId) ?? 0),
        })),
      };
    });
  }

  /** Orders waiting for the supplier to confirm - for the dashboard and alerts. */
  async pendingCount(): Promise<number> {
    return this.tenantPrisma.run((tx) =>
      tx.schoolOrder.count({ where: { status: SchoolOrderStatus.SUBMITTED } }),
    );
  }

  // ── Telling people ─────────────────────────────────────────────────────

  private async portalLink(tx: TenantTx, organizationId: string) {
    const portal = await tx.schoolPortal.findUnique({
      where: { organizationId },
      select: { slug: true },
    });
    if (!portal) return undefined;
    const base = (
      this.config.get<string>('STOREFRONT_BASE_URL') ??
      'https://shop.zarodashop.com'
    ).replace(/\/+$/, '');
    return { label: 'Open your orders', url: `${base}/schools/${portal.slug}` };
  }

  /** A message to the school: a text, and an email with the detail and a button to the portal. Never fails the work. */
  private async tell(
    order: OrderWithLines,
    subject: string,
    message: string,
    detailHtml?: string,
  ) {
    const { organizationId } = getTenantStore();
    const { org, link } = await this.tenantPrisma.run(async (tx) => ({
      org: await tx.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      link: await this.portalLink(tx, organizationId),
    }));
    await this.notifier.notify(
      {
        name: order.school.contactName ?? order.school.name,
        phone: order.school.phone,
        email: order.school.email,
      },
      org?.name ?? 'Your supplier',
      subject,
      message,
      { detailHtml, link },
    );
  }

  /** An email to the supplier's own people: the business address, its owners and managers. */
  private async tellStaff(
    subject: string,
    message: string,
    detailHtml?: string,
  ) {
    const { organizationId } = getTenantStore();
    const { org, emails } = await this.tenantPrisma.run(async (tx) => {
      const o = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, email: true },
      });
      const people = await tx.orgUser.findMany({
        where: {
          isActive: true,
          role: { in: [Role.OWNER, Role.MANAGER] },
        },
        select: { user: { select: { email: true } } },
      });
      return {
        org: o,
        emails: [o?.email, ...people.map((p) => p.user.email)].filter(
          (e): e is string => !!e,
        ),
      };
    });
    const base = this.config.get<string>('BACKOFFICE_BASE_URL');
    await this.notifier.notifyStaff(
      emails,
      org?.name ?? 'Zaroda',
      subject,
      message,
      {
        detailHtml,
        link: base
          ? {
              label: 'Open School orders',
              url: `${base.replace(/\/+$/, '')}/school-orders`,
            }
          : undefined,
      },
    );
  }
}
