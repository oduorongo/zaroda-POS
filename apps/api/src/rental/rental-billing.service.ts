import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RentalPaymentMethod } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { assertLeaseInScope, caretakerPropertyIds } from './rental-caretaker-scope';
import { CreateChargeDto, RecordPaymentDto } from './dto/rental.dto';
import {
  billingMonths,
  fromCents,
  invoiceStatus,
  monthLabel,
  monthStart,
  nairobiToday,
  newReceiptNumber,
  planAllocations,
  rentDueDate,
  toCents,
} from './rental-billing.util';

type Tx = Prisma.TransactionClient;

interface BillableLease {
  id: string;
  startDate: Date;
  endedAt: Date | null;
  monthlyRent: Prisma.Decimal;
  depositAmount: Prisma.Decimal;
  dueDay: number;
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Rent invoices, payments and balances. Everything takes a transaction so the same code runs for a signed-in
 * landlord (RentalService / controller) and for the hourly scheduler that works across businesses.
 */
@Injectable()
export class RentalBillingService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  // ── Generating invoices ─────────────────────────────────────────────────

  /**
   * Makes sure a lease has a rent invoice for every month it has run, plus its deposit invoice, then applies any
   * credit the tenant already has. Safe to run any number of times: invoices are keyed per lease, kind and month.
   */
  async syncLease(tx: Tx, organizationId: string, lease: BillableLease, today: Date = nairobiToday()): Promise<number> {
    const rows: Prisma.RentalInvoiceCreateManyInput[] = [];

    for (const month of billingMonths(lease.startDate, lease.endedAt, today)) {
      rows.push({
        organizationId,
        leaseId: lease.id,
        kind: 'RENT',
        periodMonth: month,
        description: `Rent for ${monthLabel(month)}`,
        amountDue: lease.monthlyRent,
        dueDate: rentDueDate(month, lease.dueDay, lease.startDate),
      });
    }
    if (toCents(lease.depositAmount) > 0 && lease.startDate <= today) {
      rows.push({
        organizationId,
        leaseId: lease.id,
        kind: 'DEPOSIT',
        periodMonth: monthStart(lease.startDate),
        description: 'Deposit',
        amountDue: lease.depositAmount,
        dueDate: lease.startDate,
      });
    }

    const created = rows.length ? (await tx.rentalInvoice.createMany({ data: rows, skipDuplicates: true })).count : 0;
    if (created > 0) await this.applyCredit(tx, organizationId, lease.id);
    return created;
  }

  /** Brings every active lease of the business up to date. Returns how many invoices were created. */
  async syncOrganization(tx: Tx, organizationId: string, today: Date = nairobiToday()): Promise<number> {
    const leases = await tx.rentalLease.findMany({ where: { status: 'ACTIVE' } });
    let created = 0;
    for (const lease of leases) created += await this.syncLease(tx, organizationId, lease, today);
    return created;
  }

  async generateNow() {
    const { organizationId } = getTenantStore();
    const created = await this.tenantPrisma.run((tx) => this.syncOrganization(tx, organizationId));
    return { created };
  }

  // ── Applying money to invoices ──────────────────────────────────────────

  /** Uses up any money not yet applied on the oldest open invoices. Whatever is left is the tenant's credit. */
  async applyCredit(tx: Tx, organizationId: string, leaseId: string): Promise<void> {
    const payments = await tx.rentalPayment.findMany({
      where: { leaseId, voidedAt: null },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      include: { allocations: { select: { amount: true } } },
    });
    const unapplied = payments
      .map((p) => ({
        id: p.id,
        remainingCents: toCents(p.amount) - p.allocations.reduce((s, a) => s + toCents(a.amount), 0),
      }))
      .filter((p) => p.remainingCents > 0);
    if (unapplied.length === 0) return;

    const invoices = await tx.rentalInvoice.findMany({
      where: { leaseId },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const open = invoices
      .map((i) => ({ id: i.id, outstandingCents: toCents(i.amountDue) - toCents(i.amountPaid) }))
      .filter((i) => i.outstandingCents > 0);
    const plan = planAllocations(unapplied, open);
    if (plan.length === 0) return;

    await tx.rentalPaymentAllocation.createMany({
      data: plan.map((a) => ({ organizationId, paymentId: a.paymentId, invoiceId: a.invoiceId, amount: fromCents(a.cents) })),
    });
    const perInvoice = new Map<string, number>();
    for (const a of plan) perInvoice.set(a.invoiceId, (perInvoice.get(a.invoiceId) ?? 0) + a.cents);
    for (const [invoiceId, cents] of perInvoice) {
      await tx.rentalInvoice.update({ where: { id: invoiceId }, data: { amountPaid: { increment: fromCents(cents) } } });
    }
  }

  // ── Payments ────────────────────────────────────────────────────────────

  /** Records a payment (typed in by the landlord, or confirmed automatically from M-Pesa) and applies it. */
  async recordPaymentInTx(
    tx: Tx,
    organizationId: string,
    input: {
      leaseId: string;
      amount: number;
      method: RentalPaymentMethod;
      reference?: string | null;
      paidAt?: Date;
      note?: string | null;
      invoiceId?: string | null;
    },
  ) {
    const lease = await tx.rentalLease.findUnique({ where: { id: input.leaseId } });
    if (!lease) throw new NotFoundException('Lease not found');
    const today = nairobiToday();
    if (lease.status === 'ACTIVE') await this.syncLease(tx, organizationId, lease, today);

    const paidAt = input.paidAt ?? today;
    if (paidAt > today) throw new BadRequestException('A payment cannot be dated in the future');

    const reference = input.reference?.trim().toUpperCase() || null;
    // Checked up front because after a failed insert the whole transaction is unusable, and this driver does not
    // say which unique constraint failed.
    if (reference && (await tx.rentalPayment.findFirst({ where: { reference }, select: { id: true } }))) {
      throw new ConflictException(`The reference "${reference}" has already been recorded`);
    }
    let payment;
    try {
      payment = await tx.rentalPayment.create({
        data: {
          organizationId,
          leaseId: lease.id,
          amount: input.amount,
          method: input.method,
          reference,
          paidAt,
          note: input.note?.trim() || null,
          receiptNumber: newReceiptNumber(today),
        },
      });
    } catch (e) {
      // Someone recorded the same reference a moment ago (the up-front check cannot see that yet).
      if (isUnique(e) && reference) {
        throw new ConflictException(`The reference "${reference}" has already been recorded`);
      }
      throw e;
    }

    if (input.invoiceId) {
      const invoice = await tx.rentalInvoice.findUnique({ where: { id: input.invoiceId } });
      if (!invoice || invoice.leaseId !== lease.id) throw new NotFoundException('Invoice not found on this lease');
      const take = Math.min(toCents(input.amount), toCents(invoice.amountDue) - toCents(invoice.amountPaid));
      if (take > 0) {
        await tx.rentalPaymentAllocation.create({
          data: { organizationId, paymentId: payment.id, invoiceId: invoice.id, amount: fromCents(take) },
        });
        await tx.rentalInvoice.update({ where: { id: invoice.id }, data: { amountPaid: { increment: fromCents(take) } } });
      }
    }
    await this.applyCredit(tx, organizationId, lease.id);
    return payment;
  }

  async recordPayment(dto: RecordPaymentDto) {
    const { organizationId } = getTenantStore();
    const payment = await this.tenantPrisma.run(async (tx) => {
      await assertLeaseInScope(tx, dto.leaseId);
      return this.recordPaymentInTx(tx, organizationId, {
        leaseId: dto.leaseId,
        amount: dto.amount,
        method: dto.method,
        reference: dto.reference,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
        note: dto.note,
        invoiceId: dto.invoiceId,
      });
    });
    return this.getReceipt(payment.id);
  }

  async voidPayment(id: string, reason: string) {
    await this.tenantPrisma.run(async (tx) => {
      const payment = await tx.rentalPayment.findUnique({ where: { id }, include: { allocations: true } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.voidedAt) throw new ConflictException('This payment has already been voided');
      for (const a of payment.allocations) {
        await tx.rentalInvoice.update({ where: { id: a.invoiceId }, data: { amountPaid: { decrement: a.amount } } });
      }
      await tx.rentalPaymentAllocation.deleteMany({ where: { paymentId: id } });
      await tx.rentalPayment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason.trim() } });
    });
    return this.getReceipt(id);
  }

  async listPayments(filters: { leaseId?: string; limit?: number }) {
    const payments = await this.tenantPrisma.run(async (tx) => {
      const scope = await caretakerPropertyIds(tx);
      return tx.rentalPayment.findMany({
        where: { leaseId: filters.leaseId, ...(scope ? { lease: { unit: { propertyId: { in: scope } } } } : {}) },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(filters.limit ?? 100, 500),
        include: {
          lease: {
            select: {
              tenant: { select: { id: true, name: true } },
              unit: { select: { label: true, property: { select: { name: true } } } },
            },
          },
        },
      });
    });
    return payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      amount: Number(p.amount),
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt,
      voided: p.voidedAt !== null,
      tenant: p.lease.tenant,
      unit: `${p.lease.unit.property.name} ${p.lease.unit.label}`,
    }));
  }

  // ── Charges and invoices ────────────────────────────────────────────────

  async createCharge(dto: CreateChargeDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const lease = await tx.rentalLease.findUnique({ where: { id: dto.leaseId } });
      if (!lease) throw new NotFoundException('Lease not found');
      const invoice = await tx.rentalInvoice.create({
        data: {
          organizationId,
          leaseId: lease.id,
          kind: 'OTHER',
          description: dto.description.trim(),
          amountDue: dto.amount,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : nairobiToday(),
        },
      });
      await this.applyCredit(tx, organizationId, lease.id);
      return tx.rentalInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    });
  }

  // ── Views ───────────────────────────────────────────────────────────────

  /** Every active lease with what is owed, what is overdue and any credit - the "who has paid" screen. */
  async dues() {
    const { organizationId } = getTenantStore();
    const today = nairobiToday();
    return this.tenantPrisma.run(async (tx) => {
      await this.syncOrganization(tx, organizationId, today);
      const scope = await caretakerPropertyIds(tx);
      const leases = await tx.rentalLease.findMany({
        where: { status: 'ACTIVE', ...(scope ? { unit: { propertyId: { in: scope } } } : {}) },
        include: {
          tenant: { select: { id: true, name: true, phone: true } },
          unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } },
          invoices: true,
          payments: { where: { voidedAt: null }, include: { allocations: { select: { amount: true } } } },
        },
      });
      const rows = leases.map((l) => {
        let outstanding = 0;
        let overdue = 0;
        let nextDue: Date | null = null;
        for (const inv of l.invoices) {
          const owed = toCents(inv.amountDue) - toCents(inv.amountPaid);
          if (owed <= 0) continue;
          outstanding += owed;
          if (inv.dueDate < today) overdue += owed;
          else if (!nextDue || inv.dueDate < nextDue) nextDue = inv.dueDate;
        }
        const credit = l.payments.reduce(
          (s, p) => s + toCents(p.amount) - p.allocations.reduce((t, a) => t + toCents(a.amount), 0),
          0,
        );
        const lastPaidAt = l.payments.reduce<Date | null>((latest, p) => (!latest || p.paidAt > latest ? p.paidAt : latest), null);
        return {
          leaseId: l.id,
          tenant: l.tenant,
          unit: l.unit,
          monthlyRent: Number(l.monthlyRent),
          dueDay: l.dueDay,
          outstanding: fromCents(outstanding),
          overdue: fromCents(overdue),
          credit: fromCents(credit),
          nextDue,
          lastPaidAt,
        };
      });
      return rows.sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding || a.tenant.name.localeCompare(b.tenant.name));
    });
  }

  async listInvoices(filters: { leaseId?: string; onlyOpen?: boolean }) {
    const today = nairobiToday();
    const invoices = await this.tenantPrisma.run(async (tx) => {
      const scope = await caretakerPropertyIds(tx);
      return tx.rentalInvoice.findMany({
        where: { leaseId: filters.leaseId, ...(scope ? { lease: { unit: { propertyId: { in: scope } } } } : {}) },
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      });
    });
    return invoices
      .map((i) => ({
        id: i.id,
        leaseId: i.leaseId,
        kind: i.kind,
        description: i.description,
        amountDue: Number(i.amountDue),
        amountPaid: Number(i.amountPaid),
        balance: fromCents(toCents(i.amountDue) - toCents(i.amountPaid)),
        dueDate: i.dueDate,
        status: invoiceStatus(i.amountDue, i.amountPaid, i.dueDate, today),
      }))
      .filter((i) => !filters.onlyOpen || i.status !== 'PAID');
  }

  async getReceipt(paymentId: string) {
    const { organizationId } = getTenantStore();
    const today = nairobiToday();
    return this.tenantPrisma.run(async (tx) => {
      const payment = await tx.rentalPayment.findUnique({
        where: { id: paymentId },
        include: {
          allocations: { include: { invoice: { select: { description: true, kind: true } } } },
          lease: {
            include: {
              tenant: { select: { name: true, phone: true } },
              unit: { select: { label: true, property: { select: { name: true, address: true } } } },
              invoices: true,
            },
          },
        },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      await assertLeaseInScope(tx, payment.leaseId);
      const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
      const balance = payment.lease.invoices.reduce((s, i) => s + toCents(i.amountDue) - toCents(i.amountPaid), 0);
      const applied = payment.allocations.reduce((s, a) => s + toCents(a.amount), 0);
      return {
        id: payment.id,
        receiptNumber: payment.receiptNumber,
        business: org?.name ?? '',
        amount: Number(payment.amount),
        method: payment.method,
        reference: payment.reference,
        paidAt: payment.paidAt,
        note: payment.note,
        voided: payment.voidedAt !== null,
        voidReason: payment.voidReason,
        tenant: payment.lease.tenant,
        property: payment.lease.unit.property,
        unit: payment.lease.unit.label,
        appliedTo: payment.allocations.map((a) => ({ description: a.invoice.description ?? a.invoice.kind, amount: Number(a.amount) })),
        keptAsCredit: payment.voidedAt ? 0 : fromCents(toCents(payment.amount) - applied),
        balanceAfter: fromCents(Math.max(balance, 0)),
        printedOn: today,
      };
    });
  }

  /** Every charge and payment on a lease in date order with a running balance, for handing to the tenant. */
  async statement(leaseId: string) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const lease = await tx.rentalLease.findUnique({
        where: { id: leaseId },
        include: {
          tenant: { select: { name: true, phone: true } },
          unit: { select: { label: true, property: { select: { name: true, address: true } } } },
          invoices: true,
          payments: { where: { voidedAt: null } },
        },
      });
      if (!lease) throw new NotFoundException('Lease not found');
      await assertLeaseInScope(tx, leaseId);
      const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } });

      const entries = [
        ...lease.invoices.map((i) => ({
          date: i.dueDate,
          order: 0,
          description: i.description ?? i.kind,
          charge: toCents(i.amountDue),
          paid: 0,
          reference: null as string | null,
        })),
        ...lease.payments.map((p) => ({
          date: p.paidAt,
          order: 1,
          description: `Payment (${p.method})`,
          charge: 0,
          paid: toCents(p.amount),
          reference: p.reference ?? p.receiptNumber,
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);

      let running = 0;
      const lines = entries.map((e) => {
        running += e.charge - e.paid;
        return {
          date: e.date,
          description: e.description,
          reference: e.reference,
          charge: fromCents(e.charge),
          paid: fromCents(e.paid),
          balance: fromCents(running),
        };
      });
      return {
        business: org?.name ?? '',
        tenant: lease.tenant,
        property: lease.unit.property,
        unit: lease.unit.label,
        leaseStatus: lease.status,
        startDate: lease.startDate,
        monthlyRent: Number(lease.monthlyRent),
        lines,
        // Negative means the tenant is in credit.
        balance: fromCents(running),
        printedOn: nairobiToday(),
      };
    });
  }
}
