import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { vatClaim } from '../accounting/vat-claim.util';
import { Expense } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { EXPENSE_CATEGORIES } from './expense-categories';
import { CreateExpenseDto, ListExpensesQueryDto, UpdateExpenseDto } from './dto/expense.dto';

const MAX_ROWS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const nairobiToday = () => new Date(Date.now() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

export function toExpenseView(e: Expense & { branch?: { name: string } | null }) {
  return {
    id: e.id,
    spentOn: e.spentOn.toISOString().slice(0, 10),
    category: e.category,
    categoryLabel: EXPENSE_CATEGORIES.find((c) => c.key === e.category)?.label ?? e.category,
    description: e.description,
    amount: Number(e.amount),
    taxAmount: Number(e.taxAmount),
    supplierPin: e.supplierPin,
    supplierName: e.supplierName,
    kraInvoiceNo: e.kraInvoiceNo,
    linkedToKra: !!e.etimsInvoiceId,
    vatClaim: vatClaim({ taxCents: Math.round(Number(e.taxAmount) * 100), pin: e.supplierPin, invoiceNo: e.kraInvoiceNo, linked: !!e.etimsInvoiceId }),
    paidWith: e.paidWith,
    branchId: e.branchId,
    branchName: e.branch?.name ?? null,
    createdAt: e.createdAt,
  };
}

/** A date that is plausible for money already spent: not in the future (beyond today in Nairobi), not years ago. */
function checkDay(day: string) {
  const today = nairobiToday();
  if (day > today) throw new BadRequestException('That date is in the future - record an expense once the money has been spent');
  if (toDate(day).getTime() < toDate(today).getTime() - 5 * 366 * DAY_MS) throw new BadRequestException('That date is too long ago');
}

/**
 * Money the business spent that is not stock (rent, power, wages, transport...). Recorded by an owner or manager, then
 * subtracted in the profit report. Every change leaves an audit entry - these are money records.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  categories() {
    return EXPENSE_CATEGORIES;
  }

  async create(dto: CreateExpenseDto) {
    const { organizationId, orgUserId } = getTenantStore();
    checkDay(dto.spentOn);
    if ((dto.taxAmount ?? 0) > dto.amount) throw new BadRequestException('The VAT cannot be more than the amount');
    return this.tenantPrisma.run(async (tx) => {
      if (dto.branchId && !(await tx.branch.findUnique({ where: { id: dto.branchId } }))) throw new BadRequestException('Branch not found');
      const expense = await tx.expense.create({
        data: {
          organizationId,
          branchId: dto.branchId ?? null,
          spentOn: toDate(dto.spentOn),
          category: dto.category,
          description: dto.description?.trim() || null,
          amount: round2(dto.amount),
          taxAmount: round2(dto.taxAmount ?? 0),
          supplierPin: dto.supplierPin ?? null,
          supplierName: dto.supplierName?.trim() || null,
          kraInvoiceNo: dto.kraInvoiceNo?.trim() || null,
          paidWith: dto.paidWith ?? null,
          recordedById: orgUserId,
        },
        include: { branch: { select: { name: true } } },
      });
      await this.audit.logInTx(tx, { action: 'expense.created', entityType: 'Expense', entityId: expense.id, after: toExpenseView(expense) });
      return toExpenseView(expense);
    });
  }

  async list(query: ListExpensesQueryDto) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.expense.findMany({
        where: {
          branchId: query.branchId,
          category: query.category,
          spentOn: { gte: query.from ? toDate(query.from) : undefined, lte: query.to ? toDate(query.to) : undefined },
        },
        include: { branch: { select: { name: true } } },
        orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
        take: MAX_ROWS,
      }),
    );
    const items = rows.map(toExpenseView);
    const byCategory = new Map<string, { category: string; categoryLabel: string; amount: number }>();
    for (const item of items) {
      const entry = byCategory.get(item.category) ?? { category: item.category, categoryLabel: item.categoryLabel, amount: 0 };
      entry.amount = round2(entry.amount + item.amount);
      byCategory.set(item.category, entry);
    }
    return {
      items,
      total: round2(items.reduce((sum, i) => sum + i.amount, 0)),
      byCategory: Array.from(byCategory.values()).sort((a, b) => b.amount - a.amount),
      truncated: rows.length === MAX_ROWS,
    };
  }

  async update(id: string, dto: UpdateExpenseDto) {
    if (dto.spentOn) checkDay(dto.spentOn);
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.expense.findUnique({ where: { id }, include: { branch: { select: { name: true } } } });
      if (!before) throw new NotFoundException('Expense not found');
      const differs = <T>(v: T | undefined, was: T) => v !== undefined && v !== was;
      if (
        before.etimsInvoiceId &&
        (differs(dto.amount, Number(before.amount)) ||
          differs(dto.taxAmount, Number(before.taxAmount)) ||
          differs(dto.supplierPin, before.supplierPin) ||
          differs(dto.kraInvoiceNo === undefined ? undefined : dto.kraInvoiceNo.trim() || null, before.kraInvoiceNo))
      )
        throw new BadRequestException("This expense is linked to KRA's invoice, so its amount, VAT and supplier are KRA's figures");
      if ((dto.taxAmount ?? Number(before.taxAmount)) > (dto.amount ?? Number(before.amount))) throw new BadRequestException('The VAT cannot be more than the amount');
      if (dto.branchId && !(await tx.branch.findUnique({ where: { id: dto.branchId } }))) throw new BadRequestException('Branch not found');
      const after = await tx.expense.update({
        where: { id },
        data: {
          spentOn: dto.spentOn ? toDate(dto.spentOn) : undefined,
          category: dto.category,
          amount: dto.amount === undefined ? undefined : round2(dto.amount),
          taxAmount: dto.taxAmount === undefined ? undefined : round2(dto.taxAmount),
          supplierPin: dto.supplierPin,
          supplierName: dto.supplierName === undefined ? undefined : dto.supplierName.trim() || null,
          kraInvoiceNo: dto.kraInvoiceNo === undefined ? undefined : dto.kraInvoiceNo.trim() || null,
          description: dto.description === undefined ? undefined : dto.description.trim() || null,
          paidWith: dto.paidWith,
          branchId: dto.branchId,
        },
        include: { branch: { select: { name: true } } },
      });
      await this.audit.logInTx(tx, { action: 'expense.updated', entityType: 'Expense', entityId: id, before: toExpenseView(before), after: toExpenseView(after) });
      return toExpenseView(after);
    });
  }

  async remove(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.expense.findUnique({ where: { id }, include: { branch: { select: { name: true } } } });
      if (!before) throw new NotFoundException('Expense not found');
      await tx.expense.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'expense.deleted', entityType: 'Expense', entityId: id, before: toExpenseView(before) });
      return { deleted: true };
    });
  }
}
