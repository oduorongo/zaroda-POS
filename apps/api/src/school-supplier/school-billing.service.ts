import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SupplierInvoiceStatus,
  SupplierPaymentStatus,
} from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  BouncePaymentDto,
  RecordPaymentDto,
  VoidInvoiceDto,
} from './dto/school-supplier.dto';
import { DocumentNumbersService } from './document-numbers.service';
import { invoiceBalance, statusAfterSettlement } from './school-credit.util';
import { SchoolLedgerService } from './school-ledger.service';
import { SchoolNotifierService } from './school-notifier.service';
import {
  allocateOldestFirst,
  allocationProblem,
  fromCents,
  toCents,
  todayKey,
} from './school-money.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const invoiceInclude = {
  lines: true,
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
  order: { select: { orderNumber: true, lpoNumber: true } },
  delivery: { select: { deliveryNoteNumber: true, sequence: true } },
  creditNotes: {
    select: { id: true, creditNumber: true, total: true, issueDate: true },
    orderBy: { createdAt: 'asc' as const },
  },
  allocations: {
    include: {
      payment: {
        select: {
          receiptNumber: true,
          receivedOn: true,
          method: true,
          status: true,
        },
      },
    },
  },
};
type InvoiceFull = Prisma.SupplierInvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

const paymentInclude = {
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
  allocations: {
    include: { invoice: { select: { invoiceNumber: true, total: true } } },
  },
};
type PaymentFull = Prisma.SupplierPaymentGetPayload<{
  include: typeof paymentInclude;
}>;

function toInvoiceView(i: InvoiceFull) {
  const paid = Number(i.amountPaid);
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    status: i.status,
    issueDate: day(i.issueDate),
    dueDate: day(i.dueDate),
    school: i.school,
    // the delivery note this invoice goes with (one invoice per delivery)
    order: i.order
      ? { ...i.order, deliveryNoteNumber: i.delivery?.deliveryNoteNumber ?? null }
      : null,
    deliveryId: i.deliveryId,
    saleId: i.saleId,
    subtotal: Number(i.subtotal),
    taxAmount: Number(i.taxAmount),
    total: Number(i.total),
    amountPaid: paid,
    /** What credit notes have taken off. */
    creditAmount: Number(i.creditAmount),
    expectedPaymentDate: day(i.expectedPaymentDate),
    disputed: i.disputed,
    disputeNote: i.disputeNote,
    followUpNote: i.followUpNote,
    responsibleId: i.responsibleId,
    creditNotes: i.creditNotes.map((c) => ({
      id: c.id,
      creditNumber: c.creditNumber,
      total: Number(c.total),
      issueDate: day(c.issueDate),
    })),
    balance:
      i.status === SupplierInvoiceStatus.VOID
        ? 0
        : invoiceBalance(i.total.toString(), i.amountPaid.toString(), i.creditAmount.toString()),
    notes: i.notes,
    voidedAt: i.voidedAt,
    voidReason: i.voidReason,
    lines: i.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
      lineTotal: Number(l.lineTotal),
      taxAmount: Number(l.taxAmount),
    })),
    payments: i.allocations
      .filter((a) => a.payment.status === SupplierPaymentStatus.RECEIVED)
      .map((a) => ({
        receiptNumber: a.payment.receiptNumber,
        receivedOn: day(a.payment.receivedOn),
        method: a.payment.method,
        amount: Number(a.amount),
      })),
  };
}

function toPaymentView(p: PaymentFull) {
  const allocated = p.allocations.reduce((s, a) => s + toCents(a.amount), 0);
  return {
    id: p.id,
    receiptNumber: p.receiptNumber,
    status: p.status,
    school: p.school,
    amount: Number(p.amount),
    method: p.method,
    reference: p.reference,
    bankName: p.bankName,
    chequeDate: day(p.chequeDate),
    receivedOn: day(p.receivedOn),
    notes: p.notes,
    bouncedAt: p.bouncedAt,
    bounceReason: p.bounceReason,
    allocated: fromCents(allocated),
    onAccount:
      p.status === SupplierPaymentStatus.RECEIVED
        ? fromCents(toCents(p.amount) - allocated)
        : 0,
    allocations: p.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoice.invoiceNumber,
      invoiceTotal: Number(a.invoice.total),
      amount: Number(a.amount),
    })),
  };
}

/** Invoices and the money that pays them: receipts (full or part payments), cheques that bounce, and voiding a mistaken invoice. */
@Injectable()
export class SchoolBillingService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly numbers: DocumentNumbersService,
    private readonly ledger: SchoolLedgerService,
    private readonly notifier: SchoolNotifierService,
  ) {}

  /** The business's details for the top of a printed document. */
  async letterhead() {
    const { organizationId } = getTenantStore();
    const org = await this.tenantPrisma.run((tx) =>
      tx.organization.findUnique({
        where: { id: organizationId },
        select: {
          name: true,
          address: true,
          phone: true,
          email: true,
          invoiceFooter: true,
        },
      }),
    );
    return (
      org ?? {
        name: '',
        address: null,
        phone: null,
        email: null,
        invoiceFooter: null,
      }
    );
  }

  // ── Invoices ───────────────────────────────────────────────────────────

  async listInvoices(status?: string, schoolId?: string) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.supplierInvoice.findMany({
        where: {
          ...(status ? { status: status as SupplierInvoiceStatus } : {}),
          ...(schoolId ? { schoolId } : {}),
        },
        include: invoiceInclude,
        orderBy: [{ issueDate: 'desc' }, { invoiceNumber: 'desc' }],
        take: 300,
      }),
    );
    return rows.map(toInvoiceView);
  }

  async listInvoicesForSchool(schoolId: string) {
    return this.listInvoices(undefined, schoolId);
  }

  async getInvoice(id: string, schoolId?: string) {
    const row = await this.tenantPrisma.run((tx) =>
      tx.supplierInvoice.findFirst({
        where: { id, ...(schoolId ? { schoolId } : {}) },
        include: invoiceInclude,
      }),
    );
    if (!row) throw new NotFoundException('Invoice not found');
    return { ...toInvoiceView(row), business: await this.letterhead() };
  }

  /** Cancels an invoice raised in error. Only possible while nothing has been paid against it; stock is not put back. */
  async voidInvoice(id: string, dto: VoidInvoiceDto) {
    return this.tenantPrisma.run(async (tx) => {
      const res = await tx.supplierInvoice.updateMany({
        where: {
          id,
          status: SupplierInvoiceStatus.ISSUED,
          amountPaid: 0,
          creditAmount: 0,
        },
        data: {
          status: SupplierInvoiceStatus.VOID,
          voidedAt: new Date(),
          voidReason: dto.reason.trim(),
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'Only an invoice with no payments or credit notes against it can be voided. Bounce or correct the payment first.',
        );
      // the sale it was recorded as is cancelled with it, so Sales and the reports stop counting it
      const voided = await tx.supplierInvoice.findUniqueOrThrow({
        where: { id },
        select: { saleId: true },
      });
      if (voided.saleId)
        await tx.sale.updateMany({
          where: { id: voided.saleId },
          data: { status: 'VOIDED' },
        });
      return toInvoiceView(
        await tx.supplierInvoice.findUniqueOrThrow({
          where: { id },
          include: invoiceInclude,
        }),
      );
    });
  }

  // ── Payments ───────────────────────────────────────────────────────────

  async listPayments(schoolId?: string) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.supplierPayment.findMany({
        where: schoolId ? { schoolId } : {},
        include: paymentInclude,
        orderBy: [{ receivedOn: 'desc' }, { receiptNumber: 'desc' }],
        take: 300,
      }),
    );
    return rows.map(toPaymentView);
  }

  async getPayment(id: string, schoolId?: string) {
    const row = await this.tenantPrisma.run((tx) =>
      tx.supplierPayment.findFirst({
        where: { id, ...(schoolId ? { schoolId } : {}) },
        include: paymentInclude,
      }),
    );
    if (!row) throw new NotFoundException('Receipt not found');
    return { ...toPaymentView(row), business: await this.letterhead() };
  }

  /**
   * Records money received and gives the receipt number. It may be part of what is owed: it is spread over the oldest invoices
   * first (or the ones chosen), and anything left over stays as credit on the school's account.
   */
  async recordPayment(dto: RecordPaymentDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const payment = await this.tenantPrisma.run(async (tx) => {
      const school = await tx.supplierSchool.findUnique({
        where: { id: dto.schoolId },
      });
      if (!school) throw new NotFoundException('School not found');
      if (dto.method === 'CHEQUE' && !dto.reference?.trim())
        throw new BadRequestException('Enter the cheque number');

      // One payment at a time per school, so two receipts cannot both use up the same invoice balance.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'school-pay:' + dto.schoolId}))`;

      const open = await this.ledger.openInvoices(tx, dto.schoolId);
      let allocations;
      if (dto.allocations && dto.allocations.length > 0) {
        const problem = allocationProblem(
          dto.amount,
          dto.allocations,
          new Map(open.map((o) => [o.id, o.balance])),
        );
        if (problem) throw new BadRequestException(problem);
        allocations = dto.allocations;
      } else {
        allocations = allocateOldestFirst(
          dto.amount,
          open.map((o) => ({
            id: o.id,
            balance: o.balance,
            issueDate: o.issueDate,
          })),
        ).allocations;
      }

      const receiptNumber = await this.numbers.next(tx, organizationId, 'RC');
      const created = await tx.supplierPayment.create({
        data: {
          organizationId,
          schoolId: dto.schoolId,
          receiptNumber,
          amount: dto.amount,
          method: dto.method,
          reference: dto.reference?.trim() || null,
          bankName: dto.bankName?.trim() || null,
          chequeDate: dto.chequeDate
            ? new Date(`${dto.chequeDate}T00:00:00Z`)
            : null,
          receivedOn: new Date(`${dto.receivedOn ?? todayKey()}T00:00:00Z`),
          notes: dto.notes?.trim() || null,
          recordedById: orgUserId,
          allocations: {
            create: allocations.map((a) => ({
              invoiceId: a.invoiceId,
              amount: a.amount,
            })),
          },
        },
      });
      for (const a of allocations)
        await this.applyToInvoice(tx, a.invoiceId, a.amount);
      return tx.supplierPayment.findUniqueOrThrow({
        where: { id: created.id },
        include: paymentInclude,
      });
    });

    const view = toPaymentView(payment);
    const org = await this.letterhead();
    await this.notifier.notify(
      {
        name: payment.school.contactName ?? payment.school.name,
        phone: payment.school.phone,
        email: payment.school.email,
      },
      org.name,
      `Receipt ${payment.receiptNumber}`,
      `we received KES ${view.amount.toFixed(2)} (receipt ${payment.receiptNumber}). Thank you.${view.onAccount > 0 ? ` KES ${view.onAccount.toFixed(2)} is held as credit on your account.` : ''}`,
    );
    return view;
  }

  /** A cheque that did not clear: the receipt is cancelled and the invoices it paid owe that money again. */
  async bouncePayment(id: string, dto: BouncePaymentDto) {
    return this.tenantPrisma.run(async (tx) => {
      const payment = await tx.supplierPayment.findUnique({
        where: { id },
        include: { allocations: true },
      });
      if (!payment) throw new NotFoundException('Receipt not found');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'school-pay:' + payment.schoolId}))`;
      const res = await tx.supplierPayment.updateMany({
        where: { id, status: SupplierPaymentStatus.RECEIVED },
        data: {
          status: SupplierPaymentStatus.BOUNCED,
          bouncedAt: new Date(),
          bounceReason: dto.reason.trim(),
        },
      });
      if (res.count === 0)
        throw new ConflictException(
          'This payment is already marked as bounced',
        );
      for (const a of payment.allocations)
        await this.applyToInvoice(tx, a.invoiceId, -Number(a.amount));
      return toPaymentView(
        await tx.supplierPayment.findUniqueOrThrow({
          where: { id },
          include: paymentInclude,
        }),
      );
    });
  }

  /** Adds (or, when negative, takes back) an amount paid on an invoice and sets its status to match. */
  private async applyToInvoice(
    tx: TenantTx,
    invoiceId: string,
    amount: number,
  ) {
    const inv = await tx.supplierInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    const paid = fromCents(toCents(inv.amountPaid) + toCents(amount));
    if (paid < 0 || toCents(paid) > toCents(inv.total) - toCents(inv.creditAmount))
      throw new BadRequestException(
        'That would pay more than the invoice still owes',
      );
    await tx.supplierInvoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: paid,
        status:
          inv.status === SupplierInvoiceStatus.VOID
            ? inv.status
            : statusAfterSettlement(
                Number(inv.total),
                paid,
                Number(inv.creditAmount),
              ),
      },
    });
  }
}
