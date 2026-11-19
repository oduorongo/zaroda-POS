import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PettyCashKind } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { EXPENSE_CATEGORIES } from '../expenses/expense-categories';
import { checkDay } from '../expenses/expenses.service';
import { DocumentNumbersService } from '../school-supplier/document-numbers.service';
import { todayKey } from '../school-supplier/school-money.util';
import { BookQueryDto, CountDto, CreateBoxDto, PayDto, TopUpDto, UpdateBoxDto, VoidEntryDto } from './dto/petty-cash.dto';
import { boxBalance, topUpNeeded, withBalance } from './petty-cash.util';

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const FROM = { CASH: 'the till', MPESA: 'M-Pesa', BANK: 'the bank' } as Record<string, string>;

/**
 * Petty cash: small cash boxes kept apart from the till. Payments are vouchers (PCV-) that are also Expenses paid with
 * PETTY_CASH, so they reach profit, the VAT return and the books like any expense; top-ups and counts are posted by the
 * ledger poster (source PETTY_CASH). Nothing is edited: a wrong entry is voided with a reason, and the books reverse it.
 */
@Injectable()
export class PettyCashService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly numbers: DocumentNumbersService,
    private readonly audit: AuditLogService,
  ) {}

  private async myName(tx: TenantTx) {
    const { orgUserId } = getTenantStore();
    const u = await tx.orgUser.findUnique({ where: { id: orgUserId }, select: { user: { select: { fullName: true } } } });
    return u?.user.fullName ?? null;
  }

  private async balanceOf(tx: TenantTx, boxId: string, upTo?: string) {
    const rows = await tx.pettyCashEntry.findMany({
      where: { boxId, ...(upTo ? { occurredOn: { lte: day(upTo) } } : {}) },
      select: { kind: true, amount: true, voidedAt: true },
    });
    return boxBalance(rows.map((r) => ({ kind: r.kind, amount: Number(r.amount), voided: !!r.voidedAt })));
  }

  private async box(tx: TenantTx, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`petty-cash:${id}`}))`;
    const box = await tx.pettyCashBox.findUnique({ where: { id } });
    if (!box) throw new NotFoundException('Petty cash box not found');
    return box;
  }

  private when(occurredOn?: string) {
    const d = occurredOn ?? todayKey();
    checkDay(d);
    return d;
  }

  async listBoxes() {
    return this.tenantPrisma.run(async (tx) => {
      const boxes = await tx.pettyCashBox.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
      const branches = await tx.branch.findMany({ select: { id: true, name: true } });
      return Promise.all(
        boxes.map(async (b) => {
          const balance = await this.balanceOf(tx, b.id);
          const lastCount = await tx.pettyCashEntry.findFirst({ where: { boxId: b.id, kind: PettyCashKind.COUNT, voidedAt: null }, orderBy: { occurredOn: 'desc' } });
          return {
            ...b,
            floatAmount: Number(b.floatAmount),
            branchName: branches.find((x) => x.id === b.branchId)?.name ?? null,
            balance,
            topUpNeeded: topUpNeeded(Number(b.floatAmount), balance),
            lastCountedOn: lastCount ? dayOf(lastCount.occurredOn) : null,
          };
        }),
      );
    });
  }

  /** A new box: its float is put in at once, from the till, M-Pesa or the bank. */
  async createBox(dto: CreateBoxDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      if (dto.branchId && !(await tx.branch.findUnique({ where: { id: dto.branchId } }))) throw new BadRequestException('Branch not found');
      const box = await tx.pettyCashBox.create({
        data: { organizationId, branchId: dto.branchId ?? null, name: dto.name.trim(), floatAmount: round2(dto.floatAmount), holderName: dto.holderName?.trim() || null },
      });
      await tx.pettyCashEntry.create({
        data: {
          organizationId,
          boxId: box.id,
          kind: PettyCashKind.TOP_UP,
          occurredOn: day(todayKey()),
          amount: round2(dto.floatAmount),
          topUpFrom: dto.from,
          description: `Opening float from ${FROM[dto.from]}`,
          recordedByName: await this.myName(tx),
        },
      });
      await this.audit.logInTx(tx, { action: 'pettyCash.boxCreated', entityType: 'PettyCashBox', entityId: box.id, after: { ...box, from: dto.from } });
      return box;
    });
  }

  async updateBox(id: string, dto: UpdateBoxDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await this.box(tx, id);
      const box = await tx.pettyCashBox.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          floatAmount: dto.floatAmount === undefined ? undefined : round2(dto.floatAmount),
          holderName: dto.holderName === undefined ? undefined : dto.holderName.trim() || null,
          active: dto.active,
        },
      });
      await this.audit.logInTx(tx, { action: 'pettyCash.boxUpdated', entityType: 'PettyCashBox', entityId: id, before, after: box });
      return box;
    });
  }

  /** Pays out of the box: a voucher, and the expense it is. Refused when the box does not hold that much. */
  async pay(boxId: string, dto: PayDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const on = this.when(dto.occurredOn);
    if (!EXPENSE_CATEGORIES.some((c) => c.key === dto.category)) throw new BadRequestException('Choose what the money was for');
    if ((dto.taxAmount ?? 0) > dto.amount) throw new BadRequestException('The VAT cannot be more than the amount');
    return this.tenantPrisma.run(async (tx) => {
      const box = await this.box(tx, boxId);
      if (!box.active) throw new BadRequestException('This box is closed');
      const balance = await this.balanceOf(tx, boxId);
      if (dto.amount > balance) throw new BadRequestException(`Only KES ${balance.toLocaleString('en-KE')} is in ${box.name}. Top it up first.`);
      const voucherNumber = await this.numbers.next(tx, organizationId, 'PCV');
      const expense = await tx.expense.create({
        data: {
          organizationId,
          branchId: box.branchId,
          spentOn: day(on),
          category: dto.category,
          description: `${voucherNumber}: ${dto.description.trim()} (to ${dto.receivedBy.trim()})`.slice(0, 500),
          amount: round2(dto.amount),
          taxAmount: round2(dto.taxAmount ?? 0),
          supplierPin: dto.supplierPin?.toUpperCase() ?? null,
          kraInvoiceNo: dto.kraInvoiceNo?.trim() || null,
          paidWith: 'PETTY_CASH',
          recordedById: orgUserId,
        },
      });
      const entry = await tx.pettyCashEntry.create({
        data: {
          organizationId,
          boxId,
          kind: PettyCashKind.PAYMENT,
          voucherNumber,
          occurredOn: day(on),
          amount: round2(dto.amount),
          category: dto.category,
          description: dto.description.trim(),
          receivedBy: dto.receivedBy.trim(),
          expenseId: expense.id,
          recordedByName: await this.myName(tx),
        },
      });
      await this.audit.logInTx(tx, { action: 'pettyCash.paid', entityType: 'PettyCashEntry', entityId: entry.id, after: { ...entry, expenseId: expense.id } });
      return { ...entry, balance: round2(balance - dto.amount) };
    });
  }

  /** Puts money into the box; with no amount, brings it back to its float. */
  async topUp(boxId: string, dto: TopUpDto) {
    const { organizationId } = getTenantStore();
    const on = this.when(dto.occurredOn);
    return this.tenantPrisma.run(async (tx) => {
      const box = await this.box(tx, boxId);
      if (!box.active) throw new BadRequestException('This box is closed');
      const balance = await this.balanceOf(tx, boxId);
      const amount = dto.amount ?? topUpNeeded(Number(box.floatAmount), balance);
      if (amount <= 0) throw new BadRequestException(`${box.name} is already at its float`);
      const entry = await tx.pettyCashEntry.create({
        data: {
          organizationId,
          boxId,
          kind: PettyCashKind.TOP_UP,
          occurredOn: day(on),
          amount: round2(amount),
          topUpFrom: dto.from,
          description: dto.description?.trim() || `Top-up from ${FROM[dto.from]}`,
          recordedByName: await this.myName(tx),
        },
      });
      await this.audit.logInTx(tx, { action: 'pettyCash.toppedUp', entityType: 'PettyCashEntry', entityId: entry.id, after: entry });
      return { ...entry, balance: round2(balance + amount) };
    });
  }

  /** Counts the box: any difference from what should be there is recorded (a shortage is a cost, a surplus income). */
  async count(boxId: string, dto: CountDto) {
    const { organizationId } = getTenantStore();
    const on = this.when(dto.occurredOn);
    return this.tenantPrisma.run(async (tx) => {
      const box = await this.box(tx, boxId);
      const expected = await this.balanceOf(tx, boxId);
      const difference = round2(dto.counted - expected);
      const entry = await tx.pettyCashEntry.create({
        data: {
          organizationId,
          boxId,
          kind: PettyCashKind.COUNT,
          occurredOn: day(on),
          amount: difference,
          countedAmount: round2(dto.counted),
          expectedAmount: expected,
          description: dto.description?.trim() || (difference === 0 ? 'Counted: correct' : difference < 0 ? 'Counted: short' : 'Counted: over'),
          recordedByName: await this.myName(tx),
        },
      });
      await this.audit.logInTx(tx, { action: 'pettyCash.counted', entityType: 'PettyCashEntry', entityId: entry.id, after: { ...entry, box: box.name } });
      return { ...entry, expected, difference };
    });
  }

  /** Undoes a wrong entry: a payment's expense is removed (the books reverse it); a top-up only while the box still holds it. */
  async voidEntry(entryId: string, dto: VoidEntryDto) {
    return this.tenantPrisma.run(async (tx) => {
      const found = await tx.pettyCashEntry.findUnique({ where: { id: entryId } });
      if (!found) throw new NotFoundException('Entry not found');
      await this.box(tx, found.boxId);
      const before = await tx.pettyCashEntry.findUniqueOrThrow({ where: { id: entryId } });
      if (before.voidedAt) throw new BadRequestException('This entry is already voided');
      if (before.kind === PettyCashKind.TOP_UP) {
        const balance = await this.balanceOf(tx, before.boxId);
        if (balance - Number(before.amount) < 0)
          throw new BadRequestException('The box has already spent part of this top-up, so it cannot be voided. Void the payments first, or record a count.');
      }
      if (before.expenseId) await tx.expense.deleteMany({ where: { id: before.expenseId } });
      const entry = await tx.pettyCashEntry.update({ where: { id: entryId }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'pettyCash.voided', entityType: 'PettyCashEntry', entityId: entryId, before, after: entry });
      return entry;
    });
  }

  /** The petty cash book for a period: the balance brought forward, every entry with the running balance, and the closing balance. */
  async book(boxId: string, q: BookQueryDto) {
    const to = q.to ?? todayKey();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('The start day is after the end day.');
    return this.tenantPrisma.run(async (tx) => {
      const box = await tx.pettyCashBox.findUnique({ where: { id: boxId } });
      if (!box) throw new NotFoundException('Petty cash box not found');
      const before = await tx.pettyCashEntry.findMany({ where: { boxId, occurredOn: { lt: day(from) } }, select: { kind: true, amount: true, voidedAt: true } });
      const opening = boxBalance(before.map((r) => ({ kind: r.kind, amount: Number(r.amount), voided: !!r.voidedAt })));
      const rows = await tx.pettyCashEntry.findMany({ where: { boxId, occurredOn: { gte: day(from), lte: day(to) } }, orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }] });
      const lines = withBalance(
        opening,
        rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          voided: !!r.voidedAt,
          amount: Number(r.amount),
          date: dayOf(r.occurredOn),
          voucherNumber: r.voucherNumber,
          category: r.category ? (EXPENSE_CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category) : null,
          description: r.description,
          receivedBy: r.receivedBy,
          topUpFrom: r.topUpFrom,
          countedAmount: r.countedAmount === null ? null : Number(r.countedAmount),
          recordedByName: r.recordedByName,
          voidReason: r.voidReason,
        })),
      );
      return {
        box: { ...box, floatAmount: Number(box.floatAmount) },
        from,
        to,
        opening,
        lines,
        paidOut: round2(lines.reduce((t, l) => t + (l.kind === 'PAYMENT' ? l.moneyOut : 0), 0)),
        toppedUp: round2(lines.reduce((t, l) => t + (l.kind === 'TOP_UP' ? l.moneyIn : 0), 0)),
        closing: lines.length ? lines[lines.length - 1].balance : opening,
      };
    });
  }
}
