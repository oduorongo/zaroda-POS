import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupplierInvoiceStatus } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { FollowUpDto } from './dto/school-supplier.dto';
import {
  chaseOrder,
  daysLate,
  followUpProblem,
  promiseBroken,
} from './school-collections.util';
import { SchoolLedgerService } from './school-ledger.service';
import { invoicePosition } from './school-retention.util';
import { todayKey } from './school-money.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const OPEN: SupplierInvoiceStatus[] = [
  SupplierInvoiceStatus.ISSUED,
  SupplierInvoiceStatus.PARTIALLY_PAID,
];

/**
 * Chasing unpaid invoices: which are late and by how much, whether the school promised a date (and kept it), whether it disputes
 * the invoice, who is following it up. Nothing here changes what is owed - it is the supplier's memory of the conversation.
 */
@Injectable()
export class SchoolCollectionsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly ledger: SchoolLedgerService,
    private readonly audit: AuditLogService,
  ) {}

  /** The invoices that are past their due date and still owe something, in the order to chase them. */
  async overdue() {
    const today = todayKey();
    const rows = await this.tenantPrisma.run((tx) =>
      tx.supplierInvoice.findMany({
        where: {
          status: { in: OPEN },
          dueDate: { lt: new Date(`${today}T00:00:00Z`) },
        },
        include: {
          school: {
            select: { id: true, name: true, contactName: true, phone: true },
          },
        },
        take: 500,
      }),
    );
    const list = rows
      .map((i) => {
        const balance = invoicePosition({
          total: Number(i.total),
          paid: Number(i.amountPaid),
          credited: Number(i.creditAmount),
          retentionHeld: Number(i.retentionHeld),
          writtenOff: Number(i.writtenOffAmount),
        }).dueNow;
        return {
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          school: i.school,
          issueDate: day(i.issueDate),
          dueDate: day(i.dueDate)!,
          daysLate: daysLate(day(i.dueDate)!, today),
          total: Number(i.total),
          balance,
          expectedPaymentDate: day(i.expectedPaymentDate),
          promiseBroken: promiseBroken(day(i.expectedPaymentDate), today),
          disputed: i.disputed,
          disputeNote: i.disputeNote,
          note: i.followUpNote,
          responsibleId: i.responsibleId,
          followUpUpdatedAt: i.followUpUpdatedAt,
        };
      })
      .filter((r) => r.balance > 0);
    const ordered = chaseOrder(list);
    return {
      rows: ordered,
      totals: {
        count: ordered.length,
        owed:
          Math.round(ordered.reduce((s, r) => s + r.balance * 100, 0)) / 100,
        disputed:
          Math.round(
            ordered
              .filter((r) => r.disputed)
              .reduce((s, r) => s + r.balance * 100, 0),
          ) / 100,
        brokenPromises: ordered.filter((r) => r.promiseBroken).length,
      },
    };
  }

  /** The invoices of one school that still owe something, so a payment can be set against chosen ones. */
  async openInvoicesOf(schoolId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const school = await tx.supplierSchool.findUnique({
        where: { id: schoolId },
        select: { id: true },
      });
      if (!school) throw new NotFoundException('School not found');
      return this.ledger.openInvoices(tx, schoolId);
    });
  }

  /** Records the chase on an unpaid invoice. Only the fields sent are changed; an empty text or a null date clears it. */
  async saveFollowUp(invoiceId: string, dto: FollowUpDto) {
    return this.tenantPrisma.run(async (tx) => {
      const inv = await tx.supplierInvoice.findUnique({
        where: { id: invoiceId },
      });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (!OPEN.includes(inv.status))
        throw new ConflictException(
          'Only an invoice that is still unpaid can be followed up.',
        );
      const disputed = dto.disputed ?? inv.disputed;
      const disputeNote =
        dto.disputeNote === undefined
          ? inv.disputeNote
          : dto.disputeNote?.trim() || null;
      const expected =
        dto.expectedPaymentDate === undefined
          ? day(inv.expectedPaymentDate)
          : dto.expectedPaymentDate;
      const problem = followUpProblem(
        { disputed, disputeNote, expectedPaymentDate: expected },
        day(inv.issueDate)!,
      );
      if (problem) throw new BadRequestException(problem);
      if (dto.responsibleId) {
        const person = await tx.orgUser.findFirst({
          where: { id: dto.responsibleId, isActive: true },
          select: { id: true },
        });
        if (!person)
          throw new BadRequestException(
            'That person is not a member of your staff.',
          );
      }
      const updated = await tx.supplierInvoice.update({
        where: { id: invoiceId },
        data: {
          expectedPaymentDate: expected
            ? new Date(`${expected}T00:00:00Z`)
            : null,
          disputed,
          disputeNote: disputed ? disputeNote : null,
          followUpNote:
            dto.note === undefined
              ? inv.followUpNote
              : dto.note?.trim() || null,
          responsibleId:
            dto.responsibleId === undefined
              ? inv.responsibleId
              : dto.responsibleId || null,
          followUpUpdatedAt: new Date(),
        },
      });
      await this.audit.logInTx(tx, {
        action: 'school.invoice_follow_up',
        entityType: 'SupplierInvoice',
        entityId: invoiceId,
        before: {
          expectedPaymentDate: day(inv.expectedPaymentDate),
          disputed: inv.disputed,
          responsibleId: inv.responsibleId,
        },
        after: {
          expectedPaymentDate: day(updated.expectedPaymentDate),
          disputed: updated.disputed,
          responsibleId: updated.responsibleId,
        },
      });
      return {
        id: updated.id,
        expectedPaymentDate: day(updated.expectedPaymentDate),
        disputed: updated.disputed,
        disputeNote: updated.disputeNote,
        note: updated.followUpNote,
        responsibleId: updated.responsibleId,
        followUpUpdatedAt: updated.followUpUpdatedAt,
      };
    });
  }
}
