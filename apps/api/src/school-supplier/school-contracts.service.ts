import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SchoolContractStatus,
  SchoolOrderStatus,
  SupplierInvoiceStatus,
} from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  CloseContractDto,
  SaveContractDto,
  UpdateContractDto,
  VariationDto,
} from './dto/school-supplier.dto';
import { DocumentNumbersService } from './document-numbers.service';
import { toCents, fromCents, todayKey } from './school-money.util';
import { contractFigures } from './school-tender.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const include = {
  school: { select: { id: true, name: true, phone: true } },
  tender: { select: { id: true, tenderNumber: true, title: true } },
  variations: { orderBy: { date: 'asc' as const } },
} satisfies Prisma.SchoolContractInclude;
type ContractFull = Prisma.SchoolContractGetPayload<{
  include: typeof include;
}>;

/**
 * Contracts to supply a school: the value agreed (and its variations), the period, and everything charged to it. An order can be
 * supplied under a contract; its deliveries are then invoiced against it, so the contract shows what has been used, what is left,
 * what is owed and what the profit on it is. Invoicing beyond the contract value is allowed but flagged.
 */
@Injectable()
export class SchoolContractsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly numbers: DocumentNumbersService,
    private readonly audit: AuditLogService,
  ) {}

  /** Everything charged to a contract, added up. */
  private async figures(tx: TenantTx, c: ContractFull) {
    const [invoices, credits, lines] = await Promise.all([
      tx.supplierInvoice.findMany({
        where: {
          contractId: c.id,
          status: { not: SupplierInvoiceStatus.VOID },
        },
        select: {
          total: true,
          subtotal: true,
          amountPaid: true,
          creditAmount: true,
        },
      }),
      tx.supplierCreditNote.findMany({
        where: {
          invoice: {
            contractId: c.id,
            status: { not: SupplierInvoiceStatus.VOID },
          },
        },
        select: { subtotal: true },
      }),
      tx.supplierInvoiceLine.findMany({
        where: {
          invoice: {
            contractId: c.id,
            status: { not: SupplierInvoiceStatus.VOID },
          },
          unitCost: { not: null },
        },
        select: { quantity: true, unitCost: true },
      }),
    ]);
    const sum = (rows: unknown[], pick: (r: never) => unknown) =>
      fromCents(
        rows.reduce<number>((s, r) => s + toCents(Number(pick(r as never))), 0),
      );
    const invoiced = sum(invoices, (r: { total: unknown }) => r.total);
    const subtotal = sum(invoices, (r: { subtotal: unknown }) => r.subtotal);
    const creditedSubtotal = sum(
      credits,
      (r: { subtotal: unknown }) => r.subtotal,
    );
    const cost = fromCents(
      lines.reduce(
        (s, l) => s + toCents(Number(l.quantity) * Number(l.unitCost ?? 0)),
        0,
      ),
    );
    return contractFigures({
      originalValue: Number(c.value),
      variations: fromCents(
        c.variations.reduce((s, v) => s + toCents(Number(v.amount)), 0),
      ),
      invoiced,
      credited: sum(invoices, (r: { creditAmount: unknown }) => r.creditAmount),
      paid: sum(invoices, (r: { amountPaid: unknown }) => r.amountPaid),
      netSales: fromCents(toCents(subtotal) - toCents(creditedSubtotal)),
      costOfGoods: cost,
    });
  }

  private view(c: ContractFull, f: ReturnType<typeof contractFigures>) {
    const today = todayKey();
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      reference: c.reference,
      title: c.title,
      status: c.status,
      school: c.school,
      tender: c.tender,
      startDate: day(c.startDate)!,
      endDate: day(c.endDate)!,
      /** Days to the end date (negative once it has passed); only for a contract still running. */
      daysLeft:
        c.status === SchoolContractStatus.ACTIVE
          ? Math.round(
              (c.endDate.getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
                86_400_000,
            )
          : null,
      originalValue: Number(c.value),
      variations: c.variations.map((v) => ({
        id: v.id,
        date: day(v.date)!,
        amount: Number(v.amount),
        reason: v.reason,
      })),
      notes: c.notes,
      closedAt: c.closedAt,
      closedNote: c.closedNote,
      ...f,
    };
  }

  async list(status?: string, schoolId?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.schoolContract.findMany({
        where: {
          ...(status ? { status: status as SchoolContractStatus } : {}),
          ...(schoolId ? { schoolId } : {}),
        },
        include,
        orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
        take: 300,
      });
      return Promise.all(
        rows.map(async (c) => this.view(c, await this.figures(tx, c))),
      );
    });
  }

  async get(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const c = await tx.schoolContract.findUnique({ where: { id }, include });
      if (!c) throw new NotFoundException('Contract not found');
      const [orders, invoices] = await Promise.all([
        tx.schoolOrder.findMany({
          where: { contractId: id },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            submittedAt: true,
          },
          orderBy: { submittedAt: 'desc' },
          take: 100,
        }),
        tx.supplierInvoice.findMany({
          where: { contractId: id },
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            total: true,
            amountPaid: true,
            creditAmount: true,
            status: true,
          },
          orderBy: { issueDate: 'desc' },
          take: 200,
        }),
      ]);
      return {
        ...this.view(c, await this.figures(tx, c)),
        orders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
        })),
        invoices: invoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          issueDate: day(i.issueDate)!,
          total: Number(i.total),
          paid: Number(i.amountPaid),
          credited: Number(i.creditAmount),
          status: i.status,
        })),
      };
    });
  }

  /** Makes a contract inside the caller's transaction (used when a tender is won). */
  async createInTx(
    tx: TenantTx,
    organizationId: string,
    orgUserId: string,
    dto: SaveContractDto,
    tenderId?: string,
  ) {
    if (dto.endDate < dto.startDate)
      throw new BadRequestException(
        'The contract cannot end before it starts.',
      );
    const school = await tx.supplierSchool.findUnique({
      where: { id: dto.schoolId },
      select: { id: true },
    });
    if (!school) throw new NotFoundException('School not found');
    const contractNumber = await this.numbers.next(tx, organizationId, 'CT');
    return tx.schoolContract.create({
      data: {
        organizationId,
        schoolId: dto.schoolId,
        tenderId: tenderId ?? null,
        contractNumber,
        reference: dto.reference?.trim() || null,
        title: dto.title.trim(),
        startDate: new Date(`${dto.startDate}T00:00:00Z`),
        endDate: new Date(`${dto.endDate}T00:00:00Z`),
        value: dto.value,
        notes: dto.notes?.trim() || null,
        createdById: orgUserId,
      },
      include,
    });
  }

  async create(dto: SaveContractDto) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const c = await this.createInTx(tx, organizationId, orgUserId, dto);
      await this.audit.logInTx(tx, {
        action: 'school.contract_created',
        entityType: 'SchoolContract',
        entityId: c.id,
        after: { contractNumber: c.contractNumber, value: dto.value },
      });
      return this.view(c, await this.figures(tx, c));
    });
  }

  async update(id: string, dto: UpdateContractDto) {
    return this.tenantPrisma.run(async (tx) => {
      const c = await tx.schoolContract.findUnique({ where: { id } });
      if (!c) throw new NotFoundException('Contract not found');
      if (c.status !== SchoolContractStatus.ACTIVE)
        throw new ConflictException('Only a running contract can be changed.');
      const start = dto.startDate ?? day(c.startDate)!;
      const end = dto.endDate ?? day(c.endDate)!;
      if (end < start)
        throw new BadRequestException(
          'The contract cannot end before it starts.',
        );
      const row = await tx.schoolContract.update({
        where: { id },
        data: {
          title: dto.title?.trim() ?? undefined,
          reference:
            dto.reference === undefined
              ? undefined
              : dto.reference.trim() || null,
          startDate: new Date(`${start}T00:00:00Z`),
          endDate: new Date(`${end}T00:00:00Z`),
          notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
        },
        include,
      });
      return this.view(row, await this.figures(tx, row));
    });
  }

  /** A change to the contract value. It keeps its reason and who made it, and the value stays traceable. */
  async addVariation(id: string, dto: VariationDto) {
    const { orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const c = await tx.schoolContract.findUnique({
        where: { id },
        include,
      });
      if (!c) throw new NotFoundException('Contract not found');
      if (c.status !== SchoolContractStatus.ACTIVE)
        throw new ConflictException('Only a running contract can be varied.');
      if (dto.amount === 0)
        throw new BadRequestException(
          'A variation must add or take off something.',
        );
      const now = fromCents(
        toCents(Number(c.value)) +
          c.variations.reduce((s, v) => s + toCents(Number(v.amount)), 0) +
          toCents(dto.amount),
      );
      if (now <= 0)
        throw new BadRequestException(
          'That would take the contract value to nothing or below.',
        );
      await tx.schoolContractVariation.create({
        data: {
          contractId: id,
          date: new Date(`${dto.date ?? todayKey()}T00:00:00Z`),
          amount: dto.amount,
          reason: dto.reason.trim(),
          createdById: orgUserId,
        },
      });
      await this.audit.logInTx(tx, {
        action: 'school.contract_varied',
        entityType: 'SchoolContract',
        entityId: id,
        after: { amount: dto.amount, reason: dto.reason, valueNow: now },
      });
      const row = await tx.schoolContract.findUniqueOrThrow({
        where: { id },
        include,
      });
      return this.view(row, await this.figures(tx, row));
    });
  }

  async close(id: string, dto: CloseContractDto) {
    return this.tenantPrisma.run(async (tx) => {
      const res = await tx.schoolContract.updateMany({
        where: { id, status: SchoolContractStatus.ACTIVE },
        data: {
          status: dto.outcome as SchoolContractStatus,
          closedAt: new Date(),
          closedNote: dto.note.trim(),
        },
      });
      if (res.count === 0)
        throw new ConflictException('That contract is not running.');
      await this.audit.logInTx(tx, {
        action: 'school.contract_closed',
        entityType: 'SchoolContract',
        entityId: id,
        after: { outcome: dto.outcome, note: dto.note },
      });
      const row = await tx.schoolContract.findUniqueOrThrow({
        where: { id },
        include,
      });
      return this.view(row, await this.figures(tx, row));
    });
  }

  /** Puts an order under a contract (or takes it off). The contract must be running and with the same school. */
  async linkOrder(orderId: string, contractId: string | null) {
    return this.tenantPrisma.run(async (tx) => {
      const order = await tx.schoolOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');
      if (
        order.status === SchoolOrderStatus.CANCELLED ||
        order.status === SchoolOrderStatus.DELIVERED
      )
        throw new ConflictException(
          'A finished or cancelled order cannot be moved to another contract.',
        );
      if (contractId) {
        const c = await tx.schoolContract.findUnique({
          where: { id: contractId },
        });
        if (!c) throw new NotFoundException('Contract not found');
        if (c.schoolId !== order.schoolId)
          throw new BadRequestException(
            'That contract is with a different school.',
          );
        if (c.status !== SchoolContractStatus.ACTIVE)
          throw new ConflictException('That contract is not running.');
      }
      await tx.schoolOrder.update({
        where: { id: orderId },
        data: { contractId },
      });
      return { orderId, contractId };
    });
  }

  /** The contracts of a school that are running today. */
  async runningFor(schoolId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const today = new Date(`${todayKey()}T00:00:00Z`);
      const rows = await tx.schoolContract.findMany({
        where: {
          schoolId,
          status: SchoolContractStatus.ACTIVE,
          startDate: { lte: today },
          endDate: { gte: today },
        },
        select: { id: true, contractNumber: true, title: true },
        orderBy: { endDate: 'asc' },
      });
      return rows;
    });
  }
}
