import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, SchoolTenderStatus } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  AwardTenderDto,
  ComplianceDocDto,
  SaveTenderDto,
  SaveTenderLinesDto,
  SubmitTenderDto,
} from './dto/school-supplier.dto';
import { SchoolContractsService } from './school-contracts.service';
import { todayKey } from './school-money.util';
import {
  bidTotals,
  complianceState,
  DEFAULT_CHECKLIST,
  submissionCheck,
} from './school-tender.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const include = {
  school: { select: { id: true, name: true } },
  checklist: {
    orderBy: [{ sortOrder: 'asc' as const }, { title: 'asc' as const }],
  },
  lines: { orderBy: { sortOrder: 'asc' as const } },
  contract: { select: { id: true, contractNumber: true } },
} satisfies Prisma.SchoolTenderInclude;
type TenderFull = Prisma.SchoolTenderGetPayload<{ include: typeof include }>;

const OPEN: SchoolTenderStatus[] = [
  SchoolTenderStatus.IDENTIFIED,
  SchoolTenderStatus.PREPARING,
];

/**
 * Tenders the business is bidding for. A tender is registered with its closing date and a checklist, the bid is costed line by
 * line (cost, price, margin), and submitting is blocked while the checklist is incomplete or a compliance document has expired
 * (the owner can override with a reason, which is kept). A tender that is won is turned into a contract.
 */
@Injectable()
export class SchoolTendersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly contracts: SchoolContractsService,
    private readonly audit: AuditLogService,
  ) {}

  private view(t: TenderFull) {
    const totals = bidTotals(
      t.lines.map((l) => ({
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.taxRate),
      })),
    );
    return {
      id: t.id,
      tenderNumber: t.tenderNumber,
      entityName: t.entityName,
      title: t.title,
      status: t.status,
      school: t.school,
      closingDate: day(t.closingDate),
      submittedOn: day(t.submittedOn),
      submitOverride: t.submitOverride,
      outcomeNote: t.outcomeNote,
      notes: t.notes,
      contract: t.contract,
      checklist: t.checklist.map((c) => ({
        id: c.id,
        title: c.title,
        done: c.done,
        doneAt: c.doneAt,
      })),
      lines: t.lines.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        description: l.description,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.taxRate),
      })),
      bid: totals,
    };
  }

  async list(status?: string) {
    const rows = await this.tenantPrisma.run(async (tx) => {
      // a tender that is still open but has closed is shown as such by its date; nothing is changed behind the user's back
      return tx.schoolTender.findMany({
        where: status ? { status: status as SchoolTenderStatus } : {},
        include,
        orderBy: [{ closingDate: 'asc' }, { createdAt: 'desc' }],
        take: 300,
      });
    });
    return rows.map((t) => this.view(t));
  }

  async get(id: string) {
    const t = await this.tenantPrisma.run((tx) =>
      tx.schoolTender.findUnique({ where: { id }, include }),
    );
    if (!t) throw new NotFoundException('Tender not found');
    return this.view(t);
  }

  async create(dto: SaveTenderDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const row = await this.tenantPrisma.run(async (tx) => {
      if (dto.schoolId) {
        const s = await tx.supplierSchool.findUnique({
          where: { id: dto.schoolId },
          select: { id: true },
        });
        if (!s) throw new NotFoundException('School not found');
      }
      const dup = await tx.schoolTender.findFirst({
        where: { tenderNumber: dto.tenderNumber.trim() },
        select: { id: true },
      });
      if (dup)
        throw new ConflictException(
          'A tender with that number is already registered.',
        );
      return tx.schoolTender.create({
        data: {
          organizationId,
          schoolId: dto.schoolId ?? null,
          entityName: dto.entityName.trim(),
          tenderNumber: dto.tenderNumber.trim(),
          title: dto.title.trim(),
          closingDate: dto.closingDate
            ? new Date(`${dto.closingDate}T00:00:00Z`)
            : null,
          notes: dto.notes?.trim() || null,
          createdById: orgUserId,
          checklist: {
            create: DEFAULT_CHECKLIST.map((title, sortOrder) => ({
              title,
              sortOrder,
            })),
          },
        },
        include,
      });
    });
    return this.view(row);
  }

  private async editable(tx: TenantTx, id: string) {
    const t = await tx.schoolTender.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tender not found');
    if (!OPEN.includes(t.status))
      throw new ConflictException(
        'This tender is already submitted or finished, so it cannot be changed.',
      );
    return t;
  }

  async update(id: string, dto: SaveTenderDto) {
    const row = await this.tenantPrisma.run(async (tx) => {
      await this.editable(tx, id);
      const dup = await tx.schoolTender.findFirst({
        where: { tenderNumber: dto.tenderNumber.trim(), id: { not: id } },
        select: { id: true },
      });
      if (dup)
        throw new ConflictException(
          'A tender with that number is already registered.',
        );
      return tx.schoolTender.update({
        where: { id },
        data: {
          schoolId: dto.schoolId ?? null,
          entityName: dto.entityName.trim(),
          tenderNumber: dto.tenderNumber.trim(),
          title: dto.title.trim(),
          closingDate: dto.closingDate
            ? new Date(`${dto.closingDate}T00:00:00Z`)
            : null,
          notes: dto.notes?.trim() || null,
        },
        include,
      });
    });
    return this.view(row);
  }

  async remove(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const t = await this.editable(tx, id);
      await tx.schoolTender.delete({ where: { id: t.id } });
      return { ok: true };
    });
  }

  /** Replaces the bid lines (what is offered, what it costs and what it is priced at). VAT is taken from the product when not given. */
  async setLines(id: string, dto: SaveTenderLinesDto) {
    const row = await this.tenantPrisma.run(async (tx) => {
      await this.editable(tx, id);
      const variantIds = dto.lines
        .map((l) => l.variantId)
        .filter((v): v is string => !!v);
      const variants = variantIds.length
        ? await tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            include: {
              product: {
                select: {
                  taxClass: { select: { rate: true, isExempt: true } },
                },
              },
            },
          })
        : [];
      if (variants.length !== new Set(variantIds).size)
        throw new BadRequestException('One of the products does not exist.');
      const rate = new Map(
        variants.map((v) => [
          v.id,
          v.product.taxClass && !v.product.taxClass.isExempt
            ? Number(v.product.taxClass.rate)
            : 0,
        ]),
      );
      await tx.schoolTenderLine.deleteMany({ where: { tenderId: id } });
      await tx.schoolTenderLine.createMany({
        data: dto.lines.map((l, i) => ({
          tenderId: id,
          variantId: l.variantId ?? null,
          description: l.description.trim(),
          quantity: l.quantity,
          unitCost: l.unitCost,
          unitPrice: l.unitPrice,
          taxRate:
            l.taxRate ?? (l.variantId ? (rate.get(l.variantId) ?? 0) : 0),
          sortOrder: i,
        })),
      });
      const t = await tx.schoolTender.findUniqueOrThrow({
        where: { id },
        include,
      });
      const totals = bidTotals(
        t.lines.map((l) => ({
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
          unitPrice: Number(l.unitPrice),
          taxRate: Number(l.taxRate),
        })),
      );
      return tx.schoolTender.update({
        where: { id },
        data: { bidAmount: totals.total },
        include,
      });
    });
    return this.view(row);
  }

  // ── Checklist ──

  async addCheck(id: string, title: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.editable(tx, id);
      const last = await tx.schoolTenderCheck.findFirst({
        where: { tenderId: id },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      await tx.schoolTenderCheck.create({
        data: {
          tenderId: id,
          title: title.trim(),
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      });
      return this.view(
        await tx.schoolTender.findUniqueOrThrow({ where: { id }, include }),
      );
    });
  }

  async tickCheck(id: string, itemId: string, done: boolean) {
    return this.tenantPrisma.run(async (tx) => {
      await this.editable(tx, id);
      const res = await tx.schoolTenderCheck.updateMany({
        where: { id: itemId, tenderId: id },
        data: { done, doneAt: done ? new Date() : null },
      });
      if (res.count === 0)
        throw new NotFoundException('Checklist item not found');
      return this.view(
        await tx.schoolTender.findUniqueOrThrow({ where: { id }, include }),
      );
    });
  }

  async removeCheck(id: string, itemId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.editable(tx, id);
      const res = await tx.schoolTenderCheck.deleteMany({
        where: { id: itemId, tenderId: id },
      });
      if (res.count === 0)
        throw new NotFoundException('Checklist item not found');
      return this.view(
        await tx.schoolTender.findUniqueOrThrow({ where: { id }, include }),
      );
    });
  }

  // ── Submitting and the outcome ──

  /** What stands in the way of submitting, and what is worth a look - before anyone presses the button. */
  async readiness(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const t = await tx.schoolTender.findUnique({
        where: { id },
        include: { checklist: true, lines: { select: { id: true } } },
      });
      if (!t) throw new NotFoundException('Tender not found');
      const docs = await tx.schoolComplianceDoc.findMany();
      return submissionCheck({
        closingDate: day(t.closingDate),
        today: todayKey(),
        checklist: t.checklist.map((c) => ({ title: c.title, done: c.done })),
        docs: docs.map((d) => ({
          name: d.name,
          expiryDate: day(d.expiryDate),
        })),
        hasBid: t.lines.length > 0,
      });
    });
  }

  async submit(id: string, dto: SubmitTenderDto) {
    const { role } = getTenantStore();
    const row = await this.tenantPrisma.run(async (tx) => {
      const t = await this.editable(tx, id);
      const check = await this.readiness(id);
      if (check.closed)
        throw new BadRequestException(
          'This tender has closed, so it cannot be submitted.',
        );
      let override: string | null = null;
      if (check.blockers.length > 0) {
        if (!dto.overrideReason)
          throw new BadRequestException(
            `Not ready to submit. ${check.blockers.join('. ')}. The owner can submit anyway by giving a reason.`,
          );
        if (role !== Role.OWNER)
          throw new BadRequestException(
            'Only the owner can submit in spite of these. Fix them, or ask the owner.',
          );
        override = dto.overrideReason.trim();
      }
      const updated = await tx.schoolTender.update({
        where: { id },
        data: {
          status: SchoolTenderStatus.SUBMITTED,
          submittedOn: new Date(`${todayKey()}T00:00:00Z`),
          submitOverride: override,
        },
        include,
      });
      await this.audit.logInTx(tx, {
        action: override
          ? 'school.tender_submitted_override'
          : 'school.tender_submitted',
        entityType: 'SchoolTender',
        entityId: t.id,
        after: { override, blockers: check.blockers },
      });
      return updated;
    });
    return this.view(row);
  }

  /** Won: the tender becomes a contract with the school, at the bid amount unless another value is given. */
  async award(id: string, dto: AwardTenderDto) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const t = await tx.schoolTender.findUnique({ where: { id } });
      if (!t) throw new NotFoundException('Tender not found');
      if (t.status !== SchoolTenderStatus.SUBMITTED)
        throw new ConflictException(
          'Only a submitted tender can be marked as won.',
        );
      const schoolId = dto.schoolId ?? t.schoolId;
      if (!schoolId)
        throw new BadRequestException(
          'Choose the school the contract is with (add it under Schools first if it is new).',
        );
      const value = dto.value ?? (t.bidAmount ? Number(t.bidAmount) : null);
      if (!value)
        throw new BadRequestException(
          'Enter the contract value (no bid prices were entered to take it from).',
        );
      const contract = await this.contracts.createInTx(
        tx,
        organizationId,
        orgUserId,
        {
          schoolId,
          title: t.title,
          reference: dto.reference ?? t.tenderNumber,
          startDate: dto.startDate,
          endDate: dto.endDate,
          value,
          notes: dto.notes,
        },
        t.id,
      );
      await tx.schoolTender.update({
        where: { id },
        data: { status: SchoolTenderStatus.WON, schoolId },
      });
      await this.audit.logInTx(tx, {
        action: 'school.tender_won',
        entityType: 'SchoolTender',
        entityId: id,
        after: { contractNumber: contract.contractNumber, value },
      });
      return {
        tender: this.view(
          await tx.schoolTender.findUniqueOrThrow({ where: { id }, include }),
        ),
        contractId: contract.id,
        contractNumber: contract.contractNumber,
      };
    });
  }

  /** LOST (the institution chose another bid), WITHDRAWN (we pulled out) or CANCELLED (the institution cancelled it). */
  async conclude(
    id: string,
    outcome: 'LOST' | 'WITHDRAWN' | 'CANCELLED',
    note?: string,
  ) {
    const row = await this.tenantPrisma.run(async (tx) => {
      const t = await tx.schoolTender.findUnique({ where: { id } });
      if (!t) throw new NotFoundException('Tender not found');
      const allowed: SchoolTenderStatus[] =
        outcome === 'LOST'
          ? [SchoolTenderStatus.SUBMITTED]
          : [
              SchoolTenderStatus.IDENTIFIED,
              SchoolTenderStatus.PREPARING,
              SchoolTenderStatus.SUBMITTED,
            ];
      if (!allowed.includes(t.status))
        throw new ConflictException(
          'A tender can only be marked that way before it has been decided.',
        );
      return tx.schoolTender.update({
        where: { id },
        data: {
          status: outcome as SchoolTenderStatus,
          outcomeNote: note?.trim() || null,
        },
        include,
      });
    });
    return this.view(row);
  }

  /** Moves a tender from "identified" to "preparing" when work starts on it (the first thing done on its checklist or bid). */
  async startPreparing(id: string) {
    const row = await this.tenantPrisma.run(async (tx) => {
      const t = await tx.schoolTender.findUnique({ where: { id } });
      if (!t) throw new NotFoundException('Tender not found');
      if (t.status !== SchoolTenderStatus.IDENTIFIED)
        throw new ConflictException('Work has already started on this tender.');
      return tx.schoolTender.update({
        where: { id },
        data: { status: SchoolTenderStatus.PREPARING },
        include,
      });
    });
    return this.view(row);
  }

  // ── Compliance documents ──

  private docView(d: Prisma.SchoolComplianceDocGetPayload<object>) {
    const expiry = day(d.expiryDate);
    return {
      id: d.id,
      name: d.name,
      reference: d.reference,
      issuedOn: day(d.issuedOn),
      expiryDate: expiry,
      notes: d.notes,
      state: complianceState(expiry, todayKey()),
    };
  }

  async listDocs() {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.schoolComplianceDoc.findMany({
        orderBy: [{ expiryDate: 'asc' }, { name: 'asc' }],
      }),
    );
    return rows.map((d) => this.docView(d));
  }

  async saveDoc(dto: ComplianceDocDto, id?: string) {
    const { organizationId } = getTenantStore();
    const row = await this.tenantPrisma.run(async (tx) => {
      if (dto.issuedOn && dto.expiryDate && dto.expiryDate < dto.issuedOn)
        throw new BadRequestException('It cannot expire before it was issued.');
      const data = {
        name: dto.name.trim(),
        reference: dto.reference?.trim() || null,
        issuedOn: dto.issuedOn ? new Date(`${dto.issuedOn}T00:00:00Z`) : null,
        expiryDate: dto.expiryDate
          ? new Date(`${dto.expiryDate}T00:00:00Z`)
          : null,
        notes: dto.notes?.trim() || null,
      };
      if (!id)
        return tx.schoolComplianceDoc.create({
          data: { organizationId, ...data },
        });
      const found = await tx.schoolComplianceDoc.findUnique({ where: { id } });
      if (!found) throw new NotFoundException('Document not found');
      return tx.schoolComplianceDoc.update({ where: { id }, data });
    });
    return this.docView(row);
  }

  async removeDoc(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const res = await tx.schoolComplianceDoc.deleteMany({ where: { id } });
      if (res.count === 0) throw new NotFoundException('Document not found');
      return { ok: true };
    });
  }
}
