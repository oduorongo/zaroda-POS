import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  RetentionReleaseDto,
  RetentionRequestDto,
  RetentionUpdateDto,
} from './dto/school-supplier.dto';
import { fromCents, toCents, todayKey } from './school-money.util';
import { SchoolOrdersService } from './school-orders.service';
import {
  dueDateAfterRelease,
  invoicePosition,
  releaseIsDue,
  releaseProblem,
} from './school-retention.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const include = {
  school: { select: { id: true, name: true, creditDays: true } },
  contract: { select: { id: true, contractNumber: true, title: true } },
  retentionEvents: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.SupplierInvoiceInclude;
type Row = Prisma.SupplierInvoiceGetPayload<{ include: typeof include }>;

/**
 * Retention: the share of an invoice a school holds back until a date. Until released it is owed but not due. This keeps what is
 * held, when it is expected, what has been released, and any dispute or follow-up; the invoice's own figures stay the record of
 * what is owed, and releasing retention is what makes it due.
 */
@Injectable()
export class SchoolRetentionService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly orders: SchoolOrdersService,
  ) {}

  private view(i: Row, today: string) {
    const pos = invoicePosition({
      total: Number(i.total),
      paid: Number(i.amountPaid),
      credited: Number(i.creditAmount),
      retentionHeld: Number(i.retentionHeld),
    });
    const expected = day(i.retentionReleaseDate);
    const held = pos.retention;
    const state =
      held <= 0
        ? 'RELEASED'
        : i.retentionDisputed
          ? 'DISPUTED'
          : releaseIsDue(expected, held, today)
            ? 'DUE_FOR_RELEASE'
            : 'HELD';
    return {
      invoiceId: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: day(i.issueDate)!,
      school: { id: i.school.id, name: i.school.name },
      contract: i.contract,
      invoiceTotal: Number(i.total),
      retained: Number(i.retentionAmount),
      held,
      released: fromCents(
        Math.max(0, toCents(i.retentionAmount) - toCents(held)),
      ),
      expectedReleaseDate: expected,
      requestedAt: i.retentionRequestedAt,
      disputed: i.retentionDisputed,
      disputeNote: i.retentionDisputeNote,
      note: i.retentionNote,
      state,
      daysLate:
        state === 'DUE_FOR_RELEASE' && expected
          ? Math.round(
              (new Date(`${today}T00:00:00Z`).getTime() -
                new Date(`${expected}T00:00:00Z`).getTime()) /
                86_400_000,
            )
          : 0,
      events: i.retentionEvents.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: e.amount === null ? null : Number(e.amount),
        note: e.note,
        byName: e.byName,
        at: e.createdAt,
      })),
    };
  }

  /** Every invoice that had retention: what is held, what is ready to be asked for, what is disputed. */
  async list() {
    const today = todayKey();
    const rows = await this.tenantPrisma.run((tx) =>
      tx.supplierInvoice.findMany({
        where: { retentionAmount: { gt: 0 } },
        include,
        orderBy: [{ retentionReleaseDate: 'asc' }, { invoiceNumber: 'asc' }],
        take: 1000,
      }),
    );
    const list = rows.map((r) => this.view(r, today));
    const sum = (f: (r: (typeof list)[number]) => boolean) =>
      fromCents(list.filter(f).reduce((s, r) => s + toCents(r.held), 0));
    const bySchool = new Map<
      string,
      { schoolId: string; schoolName: string; held: number }
    >();
    for (const r of list) {
      if (r.held <= 0) continue;
      const cur = bySchool.get(r.school.id) ?? {
        schoolId: r.school.id,
        schoolName: r.school.name,
        held: 0,
      };
      cur.held = fromCents(toCents(cur.held) + toCents(r.held));
      bySchool.set(r.school.id, cur);
    }
    return {
      totals: {
        held: sum(() => true),
        dueForRelease: sum((r) => r.state === 'DUE_FOR_RELEASE'),
        disputed: sum((r) => r.state === 'DISPUTED'),
        released: fromCents(
          list.reduce((s, r) => s + toCents(r.released), 0),
        ),
      },
      bySchool: [...bySchool.values()].sort((a, b) => b.held - a.held),
      rows: list,
    };
  }

  private async load(tx: Prisma.TransactionClient, id: string) {
    const inv = await tx.supplierInvoice.findUnique({ where: { id }, include });
    if (!inv || Number(inv.retentionAmount) <= 0)
      throw new NotFoundException('That invoice has no retention.');
    return inv;
  }

  /** Some or all of the retention is released: it becomes due, with the school's credit days from today. */
  async release(id: string, dto: RetentionReleaseDto) {
    const { orgUserId } = getTenantStore();
    const today = todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const inv = await this.load(tx, id);
      const held = invoicePosition({
        total: Number(inv.total),
        paid: Number(inv.amountPaid),
        credited: Number(inv.creditAmount),
        retentionHeld: Number(inv.retentionHeld),
      }).retention;
      const amount = dto.amount ?? held;
      const problem = releaseProblem(amount, held);
      if (problem) throw new BadRequestException(problem);
      const stillHeld = fromCents(toCents(inv.retentionHeld) - toCents(amount));
      await tx.supplierInvoice.update({
        where: { id },
        data: {
          retentionHeld: Math.max(0, stillHeld),
          dueDate: new Date(
            `${dueDateAfterRelease(day(inv.dueDate)!, today, inv.school.creditDays)}T00:00:00Z`,
          ),
          retentionRequestedAt: null,
          retentionDisputed: false,
          retentionDisputeNote: null,
        },
      });
      const by = await tx.orgUser.findUnique({
        where: { id: orgUserId },
        select: { user: { select: { fullName: true } } },
      });
      await tx.supplierRetentionEvent.create({
        data: {
          organizationId: inv.organizationId,
          invoiceId: id,
          kind: 'RELEASED',
          amount,
          note: dto.note?.trim() || null,
          byName: by?.user.fullName ?? null,
        },
      });
      await this.audit.logInTx(tx, {
        action: 'school.retention_released',
        entityType: 'SupplierInvoice',
        entityId: id,
        after: { invoiceNumber: inv.invoiceNumber, amount },
      });
      return this.view(await this.load(tx, id), today);
    });
  }

  /** The expected date, a dispute or a note. */
  async update(id: string, dto: RetentionUpdateDto) {
    const today = todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const inv = await this.load(tx, id);
      if (dto.disputed && !(dto.disputeNote ?? inv.retentionDisputeNote))
        throw new BadRequestException('Say what the dispute is about.');
      const data: Prisma.SupplierInvoiceUpdateInput = {};
      if (dto.expectedReleaseDate !== undefined)
        data.retentionReleaseDate = dto.expectedReleaseDate
          ? new Date(`${dto.expectedReleaseDate}T00:00:00Z`)
          : null;
      if (dto.disputed !== undefined) data.retentionDisputed = dto.disputed;
      if (dto.disputeNote !== undefined)
        data.retentionDisputeNote = dto.disputeNote?.trim() || null;
      if (dto.disputed === false) data.retentionDisputeNote = null;
      if (dto.note !== undefined)
        data.retentionNote = dto.note?.trim() || null;
      await tx.supplierInvoice.update({ where: { id }, data });
      await tx.supplierRetentionEvent.create({
        data: {
          organizationId: inv.organizationId,
          invoiceId: id,
          kind: 'UPDATED',
          note:
            [
              dto.expectedReleaseDate !== undefined
                ? `expected ${dto.expectedReleaseDate ?? 'date cleared'}`
                : null,
              dto.disputed === true ? 'marked as disputed' : null,
              dto.disputed === false ? 'dispute cleared' : null,
              dto.note ? dto.note.trim() : null,
            ]
              .filter(Boolean)
              .join('; ') || 'updated',
        },
      });
      return this.view(await this.load(tx, id), today);
    });
  }

  /** The supplier records that it asked the school to release the retention. */
  async markRequested(id: string, dto: RetentionRequestDto) {
    const today = todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const inv = await this.load(tx, id);
      if (Number(inv.retentionHeld) <= 0)
        throw new ConflictException('There is nothing held back to ask for.');
      await tx.supplierInvoice.update({
        where: { id },
        data: { retentionRequestedAt: new Date() },
      });
      await tx.supplierRetentionEvent.create({
        data: {
          organizationId: inv.organizationId,
          invoiceId: id,
          kind: 'RELEASE_REQUESTED',
          note: dto.note?.trim() || 'Asked the school to release it',
        },
      });
      return this.view(await this.load(tx, id), today);
    });
  }

  /** The school (from its portal) asks for the release to be confirmed, or says it is ready to release: the supplier is told. */
  async requestBySchool(schoolId: string, id: string, dto: RetentionRequestDto) {
    const today = todayKey();
    const result = await this.tenantPrisma.run(async (tx) => {
      const inv = await this.load(tx, id);
      if (inv.schoolId !== schoolId)
        throw new NotFoundException('That invoice has no retention.');
      if (Number(inv.retentionHeld) <= 0)
        throw new ConflictException('Nothing is held back on this invoice.');
      await tx.supplierInvoice.update({
        where: { id },
        data: { retentionRequestedAt: new Date() },
      });
      await tx.supplierRetentionEvent.create({
        data: {
          organizationId: inv.organizationId,
          invoiceId: id,
          kind: 'RELEASE_REQUESTED',
          note: dto.note?.trim() || 'Raised by the school',
          byName: inv.school.name,
        },
      });
      return {
        number: inv.invoiceNumber,
        school: inv.school.name,
        held: Number(inv.retentionHeld),
        view: this.view(await this.load(tx, id), today),
      };
    });
    await this.orders.tellStaff(
      `Retention on ${result.number}`,
      `${result.school} has raised the retention held back on invoice ${result.number} (KES ${result.held.toFixed(2)}).${dto.note ? ` Note: ${dto.note.trim()}` : ''}`,
    );
    return result.view;
  }
}
