import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SupplierBillStatus } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  CreateSupplierBillDto,
  PayBillDto,
  VoidBillDto,
  CreditBillDto,
} from './dto/supplier-bill.dto';
import {
  agePayables,
  ageBucket,
  billStatus,
  dueDateFor,
  isoDay,
  outstanding,
  paymentProblem,
  creditProblem,
  damagedValue,
} from './payables.util';

const kenyaToday = () => isoDay(new Date(Date.now() + 3 * 3_600_000));
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const money = (d: Prisma.Decimal | number) => Math.round(Number(d) * 100) / 100;

const BILL_INCLUDE = {
  supplier: { select: { id: true, name: true, phone: true } },
  payments: { orderBy: { paidAt: 'asc' } },
  credits: { orderBy: { createdAt: 'asc' } },
  receipt: {
    select: {
      id: true,
      receiptNumber: true,
      lines: { select: { quantityDamaged: true, unitCost: true } },
    },
  },
  purchaseOrder: { select: { id: true, reference: true } },
} satisfies Prisma.SupplierBillInclude;

type BillRow = Prisma.SupplierBillGetPayload<{ include: typeof BILL_INCLUDE }>;

/** What the business owes its suppliers: bills (from a delivery or typed in), payments against them, and who is owed what and how late. */
@Injectable()
export class SupplierBillsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private view(b: BillRow, today = kenyaToday()) {
    const total = money(b.total);
    const paid = money(b.amountPaid);
    const credit = money(b.creditAmount);
    const due = isoDay(b.dueDate);
    return {
      id: b.id,
      billNumber: b.billNumber,
      supplier: b.supplier,
      billDate: isoDay(b.billDate),
      dueDate: due,
      total,
      amountPaid: paid,
      creditAmount: credit,
      balance: b.status === 'VOID' ? 0 : outstanding(total, paid, credit),
      // what the damaged goods on this delivery were worth: what to ask the supplier to credit
      damagedValue: b.receipt
        ? damagedValue(
            b.receipt.lines.map((l) => ({
              quantityDamaged: Number(l.quantityDamaged),
              unitCost: l.unitCost === null ? null : Number(l.unitCost),
            })),
          )
        : 0,
      status: b.status,
      overdue:
        b.status !== 'PAID' &&
        b.status !== 'VOID' &&
        ageBucket(due, today) !== 'NOT_DUE',
      ageBucket:
        b.status === 'PAID' || b.status === 'VOID'
          ? null
          : ageBucket(due, today),
      notes: b.notes,
      receipt: b.receipt
        ? { id: b.receipt.id, receiptNumber: b.receipt.receiptNumber }
        : null,
      purchaseOrder: b.purchaseOrder,
      voidReason: b.voidReason,
      createdAt: b.createdAt,
      credits: b.credits.map((c) => ({
        id: c.id,
        amount: money(c.amount),
        reason: c.reason,
        reference: c.reference,
        createdAt: c.createdAt,
      })),
      payments: b.payments.map((p) => ({
        id: p.id,
        amount: money(p.amount),
        method: p.method,
        reference: p.reference,
        note: p.note,
        paidAt: p.paidAt,
      })),
    };
  }

  async create(dto: CreateSupplierBillDto) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: dto.supplierId },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');
      if (dto.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: dto.purchaseOrderId },
        });
        if (!po || po.supplierId !== supplier.id)
          throw new BadRequestException("That order is not this supplier's");
      }
      const billDate = dto.billDate ? dto.billDate.slice(0, 10) : kenyaToday();
      const dueDate = dto.dueDate
        ? dto.dueDate.slice(0, 10)
        : dueDateFor(billDate, supplier.paymentTermsDays);
      if (dueDate < billDate)
        throw new BadRequestException(
          'The due date cannot be before the bill date',
        );
      let bill;
      try {
        bill = await tx.supplierBill.create({
          data: {
            organizationId,
            supplierId: supplier.id,
            billNumber: dto.billNumber,
            billDate: day(billDate),
            dueDate: day(dueDate),
            total: dto.total,
            purchaseOrderId: dto.purchaseOrderId,
            notes: dto.notes || null,
            createdById: orgUserId,
          },
          include: BILL_INCLUDE,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          throw new ConflictException(
            `${supplier.name} already has a bill numbered ${dto.billNumber}`,
          );
        throw e;
      }
      await this.auditLog.logInTx(tx, {
        action: 'supplier_bill.created',
        entityType: 'SupplierBill',
        entityId: bill.id,
        after: {
          supplierId: supplier.id,
          billNumber: dto.billNumber,
          total: dto.total,
          dueDate,
        },
      });
      return this.view(bill);
    });
  }

  list(filters: {
    supplierId?: string;
    status?: SupplierBillStatus;
    overdue?: boolean;
  }) {
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.supplierBill.findMany({
        where: { supplierId: filters.supplierId, status: filters.status },
        include: BILL_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 500,
      });
      const today = kenyaToday();
      const views = rows.map((r) => this.view(r, today));
      return filters.overdue ? views.filter((v) => v.overdue) : views;
    });
  }

  async findOne(id: string) {
    const row = await this.tenantPrisma.run((tx) =>
      tx.supplierBill.findUnique({ where: { id }, include: BILL_INCLUDE }),
    );
    if (!row) throw new NotFoundException('Bill not found');
    return this.view(row);
  }

  /** Records a payment. The bill row is locked while it is checked and updated, so two payments at once cannot overpay it. */
  async pay(id: string, dto: PayBillDto) {
    const { organizationId, orgUserId } = getTenantStore();
    if (dto.method !== 'CASH' && !dto.reference)
      throw new BadRequestException(
        dto.method === 'MPESA'
          ? 'Enter the M-Pesa code'
          : dto.method === 'CHEQUE'
            ? 'Enter the cheque number'
            : 'Enter the bank reference',
      );
    return this.tenantPrisma.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_bills WHERE id = ${id} FOR UPDATE`;
      const bill = await tx.supplierBill.findUnique({ where: { id } });
      if (!bill) throw new NotFoundException('Bill not found');
      const problem = paymentProblem(
        {
          total: Number(bill.total),
          amountPaid: Number(bill.amountPaid),
          creditAmount: Number(bill.creditAmount),
          status: bill.status,
        },
        dto.amount,
      );
      if (problem) throw new ConflictException(problem);
      try {
        await tx.supplierBillPayment.create({
          data: {
            organizationId,
            billId: id,
            amount: dto.amount,
            method: dto.method,
            reference: dto.reference || null,
            note: dto.note || null,
            paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
            createdById: orgUserId,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          throw new ConflictException(
            'That payment reference has already been recorded',
          );
        throw e;
      }
      const paid =
        Math.round((Number(bill.amountPaid) + dto.amount) * 100) / 100;
      await tx.supplierBill.update({
        where: { id },
        data: {
          amountPaid: paid,
          status: billStatus(
            Number(bill.total),
            paid,
            false,
            Number(bill.creditAmount),
          ),
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'supplier_bill.paid',
        entityType: 'SupplierBill',
        entityId: id,
        after: {
          amount: dto.amount,
          method: dto.method,
          reference: dto.reference ?? null,
          paidTotal: paid,
        },
      });
      return this.view(
        await tx.supplierBill.findUniqueOrThrow({
          where: { id },
          include: BILL_INCLUDE,
        }),
      );
    });
  }

  /**
   * A credit note from the supplier (damaged goods, a wrong price): takes money off what is owed. It can only take off what is still
   * owed, and a bill that is credited down to nothing becomes paid. Only ever added.
   */
  async credit(id: string, dto: CreditBillDto) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_bills WHERE id = ${id} FOR UPDATE`;
      const bill = await tx.supplierBill.findUnique({ where: { id } });
      if (!bill) throw new NotFoundException('Bill not found');
      const problem = creditProblem(
        {
          total: Number(bill.total),
          amountPaid: Number(bill.amountPaid),
          creditAmount: Number(bill.creditAmount),
          status: bill.status,
        },
        dto.amount,
      );
      if (problem) throw new ConflictException(problem);
      await tx.supplierBillCredit.create({
        data: {
          organizationId,
          billId: id,
          amount: dto.amount,
          reason: dto.reason,
          reference: dto.reference || null,
          createdById: orgUserId,
        },
      });
      const credit =
        Math.round((Number(bill.creditAmount) + dto.amount) * 100) / 100;
      await tx.supplierBill.update({
        where: { id },
        data: {
          creditAmount: credit,
          status: billStatus(
            Number(bill.total),
            Number(bill.amountPaid),
            false,
            credit,
          ),
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'supplier_bill.credited',
        entityType: 'SupplierBill',
        entityId: id,
        after: {
          amount: dto.amount,
          reason: dto.reason,
          reference: dto.reference ?? null,
          creditTotal: credit,
        },
      });
      return this.view(
        await tx.supplierBill.findUniqueOrThrow({
          where: { id },
          include: BILL_INCLUDE,
        }),
      );
    });
  }

  /** Cancels a bill entered by mistake. A bill that already has payments cannot be - its payments would be left hanging. */
  async voidBill(id: string, dto: VoidBillDto) {
    return this.tenantPrisma.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_bills WHERE id = ${id} FOR UPDATE`;
      const bill = await tx.supplierBill.findUnique({ where: { id } });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.status === 'VOID')
        throw new ConflictException('This bill is already cancelled');
      if (Number(bill.amountPaid) > 0 || Number(bill.creditAmount) > 0)
        throw new ConflictException(
          'Payments or credit notes have been recorded on this bill, so it cannot be cancelled',
        );
      await tx.supplierBill.update({
        where: { id },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: dto.reason },
      });
      await this.auditLog.logInTx(tx, {
        action: 'supplier_bill.voided',
        entityType: 'SupplierBill',
        entityId: id,
        before: { total: Number(bill.total) },
        after: { reason: dto.reason },
      });
      return this.view(
        await tx.supplierBill.findUniqueOrThrow({
          where: { id },
          include: BILL_INCLUDE,
        }),
      );
    });
  }

  /** Who is owed what, by how late: the payables report. */
  async aging() {
    return this.tenantPrisma.run(async (tx) => {
      const bills = await tx.supplierBill.findMany({
        where: { status: { in: ['OPEN', 'PARTLY_PAID'] } },
        include: { supplier: { select: { name: true } } },
        take: 5000,
      });
      const today = kenyaToday();
      return {
        asOf: today,
        ...agePayables(
          bills.map((b) => ({
            supplierId: b.supplierId,
            supplierName: b.supplier.name,
            dueDate: isoDay(b.dueDate),
            total: Number(b.total),
            amountPaid: Number(b.amountPaid),
            creditAmount: Number(b.creditAmount),
            status: b.status,
          })),
          today,
        ),
      };
    });
  }
}
