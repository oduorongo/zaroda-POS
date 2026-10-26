import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  SupplierInvoiceStatus,
  WriteOffStatus,
} from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  BadDebtSettingsDto,
  ProvisionPostDto,
  WriteOffDecisionDto,
  WriteOffDto,
  WriteOffReverseDto,
} from './dto/school-supplier.dto';
import {
  approvalCheck,
  DEFAULT_RATES,
  needsApproval,
  provisionFor,
  Rates,
  ratesProblem,
  writeOffProblem,
} from './school-bad-debt.util';
import { statusAfterSettlement } from './school-credit.util';
import { daysBetween, fromCents, toCents, todayKey } from './school-money.util';
import { SchoolOrdersService } from './school-orders.service';
import { invoicePosition } from './school-retention.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const OPEN = [SupplierInvoiceStatus.ISSUED, SupplierInvoiceStatus.PARTIALLY_PAID];
const DEFAULT_THRESHOLD = 50_000;

type Tx = Prisma.TransactionClient;

const writeOffInclude = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      school: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.SchoolWriteOffInclude;
type WriteOffRow = Prisma.SchoolWriteOffGetPayload<{
  include: typeof writeOffInclude;
}>;

const writtenOffView = (w: WriteOffRow) => ({
  id: w.id,
  status: w.status,
  amount: Number(w.amount),
  reason: w.reason,
  invoice: {
    id: w.invoice.id,
    invoiceNumber: w.invoice.invoiceNumber,
    total: Number(w.invoice.total),
  },
  school: w.invoice.school,
  requestedByName: w.requestedByName,
  requestedAt: w.requestedAt,
  decidedByName: w.decidedByName,
  decidedAt: w.decidedAt,
  decisionNote: w.decisionNote,
  overrideReason: w.overrideReason,
  reversedAt: w.reversedAt,
  reversedByName: w.reversedByName,
  reversalReason: w.reversalReason,
});

/**
 * Bad debts. The PROVISION is an estimate: a share of what is overdue, by how late it is, set aside because some of it will not
 * be paid. It is worked out from the invoices as they stand and can be recorded from time to time to keep a history. A WRITE-OFF
 * takes a debt off what is owed because it will not be recovered; a large one needs a second person to approve it (an owner on
 * their own may approve their own, with the reason kept), and one can be put back if the school pays after all.
 */
@Injectable()
export class SchoolBadDebtsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly orders: SchoolOrdersService,
  ) {}

  private async me(tx: Tx) {
    const { orgUserId } = getTenantStore();
    const u = await tx.orgUser.findUnique({
      where: { id: orgUserId },
      select: { user: { select: { fullName: true } } },
    });
    return { id: orgUserId, name: u?.user.fullName ?? null };
  }

  private async loadSettings(tx: Tx) {
    const row = await tx.schoolBadDebtSettings.findFirst();
    const rates: Rates = row
      ? {
          D1_30: Number(row.rate1To30),
          D31_60: Number(row.rate31To60),
          D61_90: Number(row.rate61To90),
          D91_180: Number(row.rate91To180),
          D181_PLUS: Number(row.rateOver180),
        }
      : DEFAULT_RATES;
    return {
      rates,
      approvalThreshold: row ? Number(row.approvalThreshold) : DEFAULT_THRESHOLD,
    };
  }

  /** What is overdue now and the provision on it: in total, by how late it is, and by school. */
  private async provision(tx: Tx, rates: Rates) {
    const today = todayKey();
    const rows = await tx.supplierInvoice.findMany({
      where: { status: { in: OPEN } },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        creditAmount: true,
        writtenOffAmount: true,
        retentionHeld: true,
        school: { select: { id: true, name: true } },
      },
    });
    const items = rows
      .map((r) => ({
        r,
        amount: invoicePosition({
          total: Number(r.total),
          paid: Number(r.amountPaid),
          credited: Number(r.creditAmount),
          writtenOff: Number(r.writtenOffAmount),
          retentionHeld: Number(r.retentionHeld),
        }).dueNow,
        daysOverdue: daysBetween(day(r.dueDate)!, today),
      }))
      .filter((i) => i.amount > 0 && i.daysOverdue > 0);
    const total = provisionFor(items, rates);
    const bySchool = new Map<
      string,
      { schoolId: string; schoolName: string; overdue: number; provision: number }
    >();
    for (const i of items) {
      const p = provisionFor([i], rates).total;
      const cur = bySchool.get(i.r.school.id) ?? {
        schoolId: i.r.school.id,
        schoolName: i.r.school.name,
        overdue: 0,
        provision: 0,
      };
      cur.overdue = fromCents(toCents(cur.overdue) + toCents(i.amount));
      cur.provision = fromCents(toCents(cur.provision) + toCents(p));
      bySchool.set(i.r.school.id, cur);
    }
    return {
      ...total,
      bySchool: [...bySchool.values()].sort((a, b) => b.provision - a.provision),
    };
  }

  async summary() {
    return this.tenantPrisma.run(async (tx) => {
      const settings = await this.loadSettings(tx);
      const [provision, history, pending, approved] = await Promise.all([
        this.provision(tx, settings.rates),
        tx.schoolProvisionEntry.findMany({
          orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }],
          take: 12,
        }),
        tx.schoolWriteOff.count({ where: { status: WriteOffStatus.PENDING } }),
        tx.schoolWriteOff.aggregate({
          where: { status: WriteOffStatus.APPROVED },
          _sum: { amount: true },
        }),
      ]);
      return {
        settings,
        provision,
        pendingWriteOffs: pending,
        writtenOffToDate: Number(approved._sum.amount ?? 0),
        history: history.map((h) => ({
          id: h.id,
          asOf: day(h.asOf)!,
          amount: Number(h.amount),
          previous: Number(h.previous),
          overdue: Number(h.overdue),
          note: h.note,
          byName: h.byName,
        })),
      };
    });
  }

  async updateSettings(dto: BadDebtSettingsDto) {
    const rates: Rates = {
      D1_30: dto.rate1To30,
      D31_60: dto.rate31To60,
      D61_90: dto.rate61To90,
      D91_180: dto.rate91To180,
      D181_PLUS: dto.rateOver180,
    };
    const problem = ratesProblem(rates);
    if (problem) throw new BadRequestException(problem);
    const { organizationId } = getTenantStore();
    await this.tenantPrisma.run(async (tx) => {
      const data = {
        rate1To30: dto.rate1To30,
        rate31To60: dto.rate31To60,
        rate61To90: dto.rate61To90,
        rate91To180: dto.rate91To180,
        rateOver180: dto.rateOver180,
        approvalThreshold: dto.approvalThreshold,
      };
      await tx.schoolBadDebtSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data,
      });
      await this.audit.logInTx(tx, {
        action: 'school.bad_debt_settings',
        entityType: 'SchoolBadDebtSettings',
        entityId: organizationId,
        after: data,
      });
    });
    return this.summary();
  }

  /** Records the provision as it stands today, with what it was before. */
  async postProvision(dto: ProvisionPostDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const settings = await this.loadSettings(tx);
      const p = await this.provision(tx, settings.rates);
      const last = await tx.schoolProvisionEntry.findFirst({
        orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }],
      });
      const me = await this.me(tx);
      const row = await tx.schoolProvisionEntry.create({
        data: {
          organizationId,
          asOf: new Date(`${todayKey()}T00:00:00Z`),
          amount: p.total,
          previous: last ? Number(last.amount) : 0,
          overdue: p.overdue,
          note: dto.note?.trim() || null,
          byName: me.name,
        },
      });
      await this.audit.logInTx(tx, {
        action: 'school.provision_recorded',
        entityType: 'SchoolProvisionEntry',
        entityId: row.id,
        after: { amount: p.total, overdue: p.overdue },
      });
      return {
        id: row.id,
        asOf: day(row.asOf)!,
        amount: Number(row.amount),
        previous: Number(row.previous),
        overdue: Number(row.overdue),
        note: row.note,
        byName: row.byName,
      };
    });
  }

  async list(status?: WriteOffStatus) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.schoolWriteOff.findMany({
        where: status ? { status } : {},
        include: writeOffInclude,
        orderBy: { requestedAt: 'desc' },
        take: 300,
      }),
    );
    return rows.map(writtenOffView);
  }

  private outstandingOf(inv: {
    total: Prisma.Decimal;
    amountPaid: Prisma.Decimal;
    creditAmount: Prisma.Decimal;
    writtenOffAmount: Prisma.Decimal;
    retentionHeld: Prisma.Decimal;
  }) {
    return invoicePosition({
      total: Number(inv.total),
      paid: Number(inv.amountPaid),
      credited: Number(inv.creditAmount),
      writtenOff: Number(inv.writtenOffAmount),
      retentionHeld: Number(inv.retentionHeld),
    }).outstanding;
  }

  /** Takes the amount off the invoice (the write-off has been approved). */
  private async applyWriteOff(tx: Tx, invoiceId: string, amount: number) {
    const inv = await tx.supplierInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    if (inv.status === SupplierInvoiceStatus.VOID)
      throw new ConflictException('That invoice was cancelled.');
    const problem = writeOffProblem(amount, this.outstandingOf(inv));
    if (problem) throw new BadRequestException(problem);
    const written = fromCents(toCents(inv.writtenOffAmount) + toCents(amount));
    const nothingLeft =
      toCents(inv.total) -
        toCents(inv.amountPaid) -
        toCents(inv.creditAmount) -
        toCents(written) <=
      0;
    await tx.supplierInvoice.update({
      where: { id: invoiceId },
      data: {
        writtenOffAmount: written,
        // nothing left owing: settled by payments and credits, or closed by the write-off
        status: nothingLeft
          ? toCents(inv.amountPaid) + toCents(inv.creditAmount) >=
            toCents(inv.total)
            ? SupplierInvoiceStatus.PAID
            : SupplierInvoiceStatus.WRITTEN_OFF
          : inv.status,
      },
    });
  }

  /** A write-off is asked for. Below the threshold it takes effect at once; at or above it waits for a second person. */
  async request(dto: WriteOffDto) {
    const { organizationId } = getTenantStore();
    const out = await this.tenantPrisma.run(async (tx) => {
      const inv = await tx.supplierInvoice.findUnique({
        where: { id: dto.invoiceId },
        include: { school: { select: { id: true, name: true } } },
      });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status === SupplierInvoiceStatus.VOID)
        throw new ConflictException('That invoice was cancelled.');
      const outstanding = this.outstandingOf(inv);
      const pending = await tx.schoolWriteOff.aggregate({
        where: { invoiceId: inv.id, status: WriteOffStatus.PENDING },
        _sum: { amount: true },
      });
      const free = fromCents(
        toCents(outstanding) - toCents(Number(pending._sum.amount ?? 0)),
      );
      const amount = dto.amount ?? free;
      const problem = writeOffProblem(amount, free);
      if (problem) throw new BadRequestException(problem);
      const settings = await this.loadSettings(tx);
      const me = await this.me(tx);
      const second = needsApproval(amount, settings.approvalThreshold);
      const row = await tx.schoolWriteOff.create({
        data: {
          organizationId,
          invoiceId: inv.id,
          amount,
          reason: dto.reason.trim(),
          status: second ? WriteOffStatus.PENDING : WriteOffStatus.APPROVED,
          requestedById: me.id,
          requestedByName: me.name,
          decidedById: second ? null : me.id,
          decidedByName: second ? null : me.name,
          decidedAt: second ? null : new Date(),
        },
        include: writeOffInclude,
      });
      if (!second) await this.applyWriteOff(tx, inv.id, amount);
      await this.audit.logInTx(tx, {
        action: second ? 'school.writeoff_requested' : 'school.writeoff_done',
        entityType: 'SchoolWriteOff',
        entityId: row.id,
        after: { invoice: inv.invoiceNumber, amount, reason: row.reason },
      });
      return { view: writtenOffView(row), second, school: inv.school.name };
    });
    if (out.second)
      await this.orders.tellStaff(
        'A write-off needs approving',
        `A write-off of KES ${out.view.amount.toFixed(2)} on invoice ${out.view.invoice.invoiceNumber} (${out.school}) is waiting for a second person to approve it. Reason: ${out.view.reason}`,
      );
    return out.view;
  }

  private async pendingOne(tx: Tx, id: string) {
    const w = await tx.schoolWriteOff.findUnique({
      where: { id },
      include: writeOffInclude,
    });
    if (!w) throw new NotFoundException('Write-off not found');
    if (w.status !== WriteOffStatus.PENDING)
      throw new ConflictException('That write-off has already been dealt with.');
    return w;
  }

  /** A second person approves it. The person who asked cannot, unless they are the owner and say why (recorded and audited). */
  async approve(id: string, dto: WriteOffDecisionDto) {
    const { role } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const w = await this.pendingOne(tx, id);
      const me = await this.me(tx);
      const check = approvalCheck({
        requesterId: w.requestedById,
        approverId: me.id,
        approverIsOwner: role === Role.OWNER,
        overrideReason: dto.overrideReason,
      });
      if ('problem' in check) throw new ForbiddenException(check.problem);
      await this.applyWriteOff(tx, w.invoiceId, Number(w.amount));
      const row = await tx.schoolWriteOff.update({
        where: { id },
        data: {
          status: WriteOffStatus.APPROVED,
          decidedById: me.id,
          decidedByName: me.name,
          decidedAt: new Date(),
          decisionNote: dto.note?.trim() || null,
          overrideReason: check.overridden ? dto.overrideReason!.trim() : null,
        },
        include: writeOffInclude,
      });
      await this.audit.logInTx(tx, {
        action: check.overridden
          ? 'school.writeoff_self_approved'
          : 'school.writeoff_approved',
        entityType: 'SchoolWriteOff',
        entityId: id,
        after: {
          invoice: w.invoice.invoiceNumber,
          amount: Number(w.amount),
          overrideReason: check.overridden ? dto.overrideReason : undefined,
        },
      });
      return writtenOffView(row);
    });
  }

  async reject(id: string, dto: WriteOffDecisionDto) {
    return this.tenantPrisma.run(async (tx) => {
      const w = await this.pendingOne(tx, id);
      const me = await this.me(tx);
      const row = await tx.schoolWriteOff.update({
        where: { id },
        data: {
          status: WriteOffStatus.REJECTED,
          decidedById: me.id,
          decidedByName: me.name,
          decidedAt: new Date(),
          decisionNote: dto.note?.trim() || null,
        },
        include: writeOffInclude,
      });
      await this.audit.logInTx(tx, {
        action: 'school.writeoff_rejected',
        entityType: 'SchoolWriteOff',
        entityId: id,
        after: { invoice: w.invoice.invoiceNumber, amount: Number(w.amount) },
      });
      return writtenOffView(row);
    });
  }

  /** Puts a write-off back: the invoice owes that much again. */
  async reverse(id: string, dto: WriteOffReverseDto) {
    return this.tenantPrisma.run(async (tx) => {
      const w = await tx.schoolWriteOff.findUnique({
        where: { id },
        include: writeOffInclude,
      });
      if (!w) throw new NotFoundException('Write-off not found');
      if (w.status !== WriteOffStatus.APPROVED)
        throw new ConflictException('Only a write-off that took effect can be put back.');
      const inv = await tx.supplierInvoice.findUniqueOrThrow({
        where: { id: w.invoiceId },
      });
      const written = fromCents(
        Math.max(0, toCents(inv.writtenOffAmount) - toCents(w.amount)),
      );
      await tx.supplierInvoice.update({
        where: { id: inv.id },
        data: {
          writtenOffAmount: written,
          status:
            inv.status === SupplierInvoiceStatus.VOID
              ? inv.status
              : statusAfterSettlement(
                  Number(inv.total),
                  Number(inv.amountPaid) + Number(written),
                  Number(inv.creditAmount),
                ),
        },
      });
      const me = await this.me(tx);
      const row = await tx.schoolWriteOff.update({
        where: { id },
        data: {
          status: WriteOffStatus.REVERSED,
          reversedAt: new Date(),
          reversedByName: me.name,
          reversalReason: dto.reason.trim(),
        },
        include: writeOffInclude,
      });
      await this.audit.logInTx(tx, {
        action: 'school.writeoff_reversed',
        entityType: 'SchoolWriteOff',
        entityId: id,
        after: { invoice: w.invoice.invoiceNumber, amount: Number(w.amount), reason: dto.reason },
      });
      return writtenOffView(row);
    });
  }
}
