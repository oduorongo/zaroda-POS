import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConPermitType, ConProject, ConWorksClass, Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PrivateObjectStorageService } from '../../common/storage/private-object-storage.service';
import { getTenantStore } from '../../common/tenant/tenant-context';
import { ConContext, Tx, canSeeAllProjects, isDirector } from '../common/con-access';
import { ComplianceService } from '../compliance/compliance.service';
import { daysLeft, expiryState, todayKey } from '../compliance/compliance.util';
import { MemberDto, MilestoneDto, PartyDto, PermitDto, ProjectDto, ProjectPartyDto, ProjectStatusDto } from '../dto/projects.dto';
import { ConPlansService } from '../plans/con-plans.service';
import { PERMIT_LABELS, PERMIT_TYPES, nextCode, programmeProgress, statusChecks } from './projects.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s?: string) => (s ? new Date(`${s}T00:00:00Z`) : null);
const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Checks the NCA cap; above it only a Director may go ahead, with a reason that is kept. */
export async function enforceCap(tx: Tx, compliance: ComplianceService, con: ConContext, worksClass: ConWorksClass, value: number, overrideReason?: string) {
  const r = await compliance.capCheckIn(tx, con.organizationId, worksClass, value);
  if (r.ok) return { capOverrideReason: null, capOverrideBy: null };
  if (!overrideReason?.trim()) throw new BadRequestException({ statusCode: 400, message: r.reason, capExceeded: true });
  if (!isDirector(con)) throw new ForbiddenException(r.reason);
  return { capOverrideReason: overrideReason.trim(), capOverrideBy: con.orgUserId };
}

/** Projects (docs/construction/01 s3): details, status with the NCA/county/NEMA checks, parties, team, permits and programme. */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly compliance: ComplianceService,
    private readonly plans: ConPlansService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  private async load(tx: Tx, projectId: string) {
    const p = await tx.conProject.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private view(p: ConProject & { client?: { id: string; name: string } | null }, extra: { bqTotal?: number; progress?: number } = {}) {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      client: p.client ?? null,
      tenderId: p.tenderId,
      worksClass: p.worksClass,
      contractSum: Number(p.contractSum),
      revisedSum: num(p.revisedSum),
      formOfContract: p.formOfContract,
      startDate: day(p.startDate),
      completionDate: day(p.completionDate),
      dlpMonths: p.dlpMonths,
      retentionRate: Number(p.retentionRate),
      retentionLimit: Number(p.retentionLimit),
      county: p.county,
      location: p.location,
      lat: num(p.lat),
      lng: num(p.lng),
      capOverrideReason: p.capOverrideReason,
      ...extra,
    };
  }

  /** Creates the project with its permit checklist. Counts toward the plan's active-project limit (closed projects do not). */
  async createIn(tx: Tx, con: ConContext, dto: ProjectDto & { tenderId?: string; capOverride?: { capOverrideReason: string | null; capOverrideBy: string | null } }) {
    const { organizationId, orgUserId } = con;
    await this.plans.assertCanAdd(tx, organizationId, 'activeProjects', await tx.conProject.count({ where: { status: { not: 'CLOSED' } } }));
    const cap = dto.capOverride ?? (await enforceCap(tx, this.compliance, con, dto.worksClass, dto.contractSum, dto.overrideReason));
    if (dto.clientId && !(await tx.conParty.findUnique({ where: { id: dto.clientId } }))) throw new BadRequestException('That client was not found');
    if (dto.startDate && dto.completionDate && dto.completionDate < dto.startDate) throw new BadRequestException('Completion cannot be before the start.');
    const codes = (await tx.conProject.findMany({ select: { code: true } })).map((c) => c.code);
    const code = dto.code?.trim().toUpperCase() || nextCode('PRJ', codes);
    if (codes.includes(code)) throw new ConflictException(`Project code ${code} is already used`);
    const retention = await tx.conTaxSetting.findFirst({ where: { key: 'RETENTION_DEFAULT', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } });
    const limit = await tx.conTaxSetting.findFirst({ where: { key: 'RETENTION_LIMIT', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } });
    const project = await tx.conProject.create({
      data: {
        organizationId,
        code,
        name: dto.name.trim(),
        clientId: dto.clientId ?? null,
        tenderId: dto.tenderId ?? null,
        worksClass: dto.worksClass,
        contractSum: dto.contractSum,
        formOfContract: dto.formOfContract ?? 'JBC',
        startDate: date(dto.startDate),
        completionDate: date(dto.completionDate),
        dlpMonths: dto.dlpMonths ?? 12,
        retentionRate: dto.retentionRate ?? (retention ? Number(retention.rate) : 10),
        retentionLimit: dto.retentionLimit ?? (limit ? Number(limit.rate) : 5),
        county: dto.county?.trim() || null,
        location: dto.location?.trim() || null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        createdBy: orgUserId,
        ...cap,
      },
    });
    await tx.conProjectPermit.createMany({ data: PERMIT_TYPES.map((type) => ({ organizationId, projectId: project.id, type })) });
    await this.audit.logInTx(tx, { action: 'con_project.created', entityType: 'ConProject', entityId: project.id, after: project });
    return project;
  }

  async create(con: ConContext, dto: ProjectDto) {
    const p = await this.tenantPrisma.run((tx) => this.createIn(tx, con, dto));
    return this.view(p);
  }

  async list(con: ConContext) {
    return this.tenantPrisma.run(async (tx) => {
      const where = canSeeAllProjects(con) ? {} : { members: { some: { orgUserId: con.orgUserId } } };
      const rows = await tx.conProject.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], include: { client: { select: { id: true, name: true } }, milestones: true } });
      const totals = await tx.conBqItem.groupBy({ by: ['projectId'], _sum: { amount: true }, where: { projectId: { in: rows.map((r) => r.id) } } });
      const byId = new Map(totals.map((t) => [t.projectId, Number(t._sum.amount ?? 0)]));
      return rows.map((p) => this.view(p, { bqTotal: byId.get(p.id) ?? 0, progress: programmeProgress(p.milestones) }));
    });
  }

  async get(projectId: string) {
    const today = todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const p = await tx.conProject.findUnique({
        where: { id: projectId },
        include: {
          client: { select: { id: true, name: true } },
          parties: { include: { party: true } },
          members: { include: { orgUser: { select: { id: true, user: { select: { fullName: true, email: true } }, conAccreditation: true } } } },
          permits: true,
          milestones: { orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }] },
        },
      });
      if (!p) throw new NotFoundException('Project not found');
      const bqTotal = Number((await tx.conBqItem.aggregate({ where: { projectId }, _sum: { amount: true } }))._sum.amount ?? 0);
      return {
        ...this.view(p, { bqTotal, progress: programmeProgress(p.milestones) }),
        parties: p.parties.map((l) => ({ id: l.id, role: l.role, party: { id: l.party.id, name: l.party.name, contactPerson: l.party.contactPerson, phone: l.party.phone, email: l.party.email } })),
        members: p.members.map((m) => {
          const exp = day(m.orgUser.conAccreditation?.expiresAt ?? null);
          return { id: m.id, role: m.role, orgUserId: m.orgUserId, fullName: m.orgUser.user.fullName, email: m.orgUser.user.email, ncaCard: exp ? { cardNo: m.orgUser.conAccreditation!.cardNo, expiresAt: exp, state: expiryState(exp, today), daysLeft: daysLeft(exp, today) } : null };
        }),
        permits: PERMIT_TYPES.map((type) => {
          const r = p.permits.find((x) => x.type === type);
          const exp = day(r?.expiresAt ?? null);
          return { id: r?.id ?? null, type, label: PERMIT_LABELS[type], status: r?.status ?? 'PENDING', refNo: r?.refNo ?? null, issuedAt: day(r?.issuedAt ?? null), expiresAt: exp, expiryState: expiryState(exp, today), notes: r?.notes ?? null, hasFile: !!r?.fileKey };
        }),
        milestones: p.milestones.map((m) => ({ id: m.id, name: m.name, startDate: day(m.startDate), endDate: day(m.endDate), percentComplete: m.percentComplete, sortOrder: m.sortOrder })),
      };
    });
  }

  async update(con: ConContext, projectId: string, dto: ProjectDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await this.load(tx, projectId);
      if (before.status === 'CLOSED') throw new ConflictException('A closed project cannot be changed.');
      const valueChanged = Number(before.contractSum) !== dto.contractSum || before.worksClass !== dto.worksClass;
      const cap = valueChanged ? await enforceCap(tx, this.compliance, con, dto.worksClass, dto.contractSum, dto.overrideReason) : {};
      if (dto.clientId && !(await tx.conParty.findUnique({ where: { id: dto.clientId } }))) throw new BadRequestException('That client was not found');
      const code = dto.code?.trim().toUpperCase();
      if (code && code !== before.code && (await tx.conProject.findFirst({ where: { code } }))) throw new ConflictException(`Project code ${code} is already used`);
      const after = await tx.conProject.update({
        where: { id: projectId },
        data: {
          ...(code ? { code } : {}),
          name: dto.name.trim(),
          clientId: dto.clientId ?? null,
          worksClass: dto.worksClass,
          contractSum: dto.contractSum,
          formOfContract: dto.formOfContract ?? before.formOfContract,
          startDate: date(dto.startDate),
          completionDate: date(dto.completionDate),
          dlpMonths: dto.dlpMonths ?? before.dlpMonths,
          retentionRate: dto.retentionRate ?? before.retentionRate,
          retentionLimit: dto.retentionLimit ?? before.retentionLimit,
          county: dto.county?.trim() || null,
          location: dto.location?.trim() || null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          ...cap,
        },
      });
      await this.audit.logInTx(tx, { action: 'con_project.updated', entityType: 'ConProject', entityId: projectId, before, after });
      return this.view(after);
    });
  }

  async setStatus(con: ConContext, projectId: string, dto: ProjectStatusDto) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.load(tx, projectId);
      const [permits, settings, wiba, bq] = await Promise.all([
        tx.conProjectPermit.findMany({ where: { projectId } }),
        tx.conSettings.findUnique({ where: { organizationId: con.organizationId } }),
        tx.conComplianceDoc.findFirst({ where: { type: 'WIBA', OR: [{ expiresAt: null }, { expiresAt: { gte: date(todayKey())! } }] } }),
        tx.conBqItem.aggregate({ where: { projectId }, _sum: { amount: true } }),
      ]);
      const checks = statusChecks({
        from: p.status,
        to: dto.status,
        permits: Object.fromEntries(permits.map((x) => [x.type, x.status])) as Partial<Record<ConPermitType, (typeof permits)[number]['status']>>,
        ncaProjectRegRule: settings?.ncaProjectRegRule ?? 'BLOCK',
        wibaValid: !!wiba,
        bqTotal: Number(bq._sum.amount ?? 0),
        contractSum: Number(p.contractSum),
        hasClient: !!p.clientId,
      });
      if (checks.blocks.length) throw new BadRequestException({ statusCode: 400, message: checks.blocks.join(' '), blocks: checks.blocks, warnings: checks.warnings });
      if (checks.warnings.length && !dto.confirm) throw new ConflictException({ statusCode: 409, message: 'Check these before going ahead.', warnings: checks.warnings, needsConfirm: true });
      const after = await tx.conProject.update({ where: { id: projectId }, data: { status: dto.status } });
      await this.audit.logInTx(tx, { action: 'con_project.status_changed', entityType: 'ConProject', entityId: projectId, before: { status: p.status }, after: { status: after.status, warningsAccepted: checks.warnings } });
      return this.view(after);
    });
  }

  // ── Parties ──

  async listParties() {
    return this.tenantPrisma.run((tx) => tx.conParty.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }));
  }

  async saveParty(dto: PartyDto, id?: string) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const data = { kind: dto.kind, name: dto.name.trim(), contactPerson: dto.contactPerson?.trim() || null, kraPin: dto.kraPin?.trim().toUpperCase() || null, phone: dto.phone?.trim() || null, email: dto.email?.trim().toLowerCase() || null };
      if (!id) {
        const after = await tx.conParty.create({ data: { organizationId, createdBy: orgUserId, ...data } });
        await this.audit.logInTx(tx, { action: 'con_party.created', entityType: 'ConParty', entityId: after.id, after });
        return after;
      }
      const before = await tx.conParty.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Party not found');
      const after = await tx.conParty.update({ where: { id }, data });
      await this.audit.logInTx(tx, { action: 'con_party.updated', entityType: 'ConParty', entityId: id, before, after });
      return after;
    });
  }

  async linkParty(projectId: string, dto: ProjectPartyDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await this.load(tx, projectId);
      if (!(await tx.conParty.findUnique({ where: { id: dto.partyId } }))) throw new NotFoundException('Party not found');
      const link = await tx.conProjectParty.upsert({ where: { projectId_partyId_role: { projectId, partyId: dto.partyId, role: dto.role } }, create: { organizationId, projectId, ...dto }, update: {} });
      await this.audit.logInTx(tx, { action: 'con_project_party.linked', entityType: 'ConProjectParty', entityId: link.id, after: link });
      return link;
    });
  }

  async unlinkParty(projectId: string, linkId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conProjectParty.findFirst({ where: { id: linkId, projectId } });
      if (!before) throw new NotFoundException('Not on this project');
      await tx.conProjectParty.delete({ where: { id: linkId } });
      await this.audit.logInTx(tx, { action: 'con_project_party.unlinked', entityType: 'ConProjectParty', entityId: linkId, before });
      return { ok: true };
    });
  }

  // ── Team ──

  /** A Site Supervisor must hold a valid NCA accreditation; within 30 days of expiry it still works but warns. */
  async addMember(projectId: string, dto: MemberDto) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await this.load(tx, projectId);
      const user = await tx.orgUser.findUnique({ where: { id: dto.orgUserId }, include: { conAccreditation: true } });
      if (!user?.isActive) throw new NotFoundException('Staff member not found');
      let warning: string | null = null;
      if (dto.role === 'CON_SITE_SUPERVISOR') {
        const exp = day(user.conAccreditation?.expiresAt ?? null);
        if (!exp) throw new BadRequestException('A Site Supervisor needs an NCA accreditation card. Record it under Staff & roles first.');
        const left = daysLeft(exp, todayKey());
        if (left < 0) throw new BadRequestException(`Their NCA accreditation card expired on ${exp}. Renew it before making them Site Supervisor.`);
        if (left <= 30) warning = `Their NCA accreditation card expires in ${left} days (${exp}).`;
      }
      const member = await tx.conProjectMember.upsert({
        where: { projectId_orgUserId_role: { projectId, orgUserId: dto.orgUserId, role: dto.role } },
        create: { organizationId, projectId, orgUserId: dto.orgUserId, role: dto.role, createdBy: orgUserId },
        update: {},
      });
      await this.audit.logInTx(tx, { action: 'con_project_member.added', entityType: 'ConProjectMember', entityId: member.id, after: member });
      return { ...member, warning };
    });
  }

  async removeMember(projectId: string, memberId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conProjectMember.findFirst({ where: { id: memberId, projectId } });
      if (!before) throw new NotFoundException('Not on this project');
      await tx.conProjectMember.delete({ where: { id: memberId } });
      await this.audit.logInTx(tx, { action: 'con_project_member.removed', entityType: 'ConProjectMember', entityId: memberId, before });
      return { ok: true };
    });
  }

  // ── Permits ──

  private async permitRow(tx: Tx, projectId: string, type: ConPermitType) {
    const { organizationId } = getTenantStore();
    await this.load(tx, projectId);
    return tx.conProjectPermit.upsert({ where: { projectId_type: { projectId, type } }, create: { organizationId, projectId, type }, update: {} });
  }

  async updatePermit(projectId: string, type: ConPermitType, dto: PermitDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await this.permitRow(tx, projectId, type);
      if (dto.issuedAt && dto.expiresAt && dto.expiresAt < dto.issuedAt) throw new BadRequestException('It cannot expire before it was issued.');
      const after = await tx.conProjectPermit.update({ where: { id: before.id }, data: { status: dto.status, refNo: dto.refNo?.trim() || null, issuedAt: date(dto.issuedAt), expiresAt: date(dto.expiresAt), notes: dto.notes?.trim() || null } });
      await this.audit.logInTx(tx, { action: 'con_permit.updated', entityType: 'ConProjectPermit', entityId: after.id, before, after });
      return after;
    });
  }

  async uploadPermitFile(projectId: string, type: ConPermitType, contentType: string, body: Buffer, fileName?: string) {
    const { organizationId } = getTenantStore();
    const ext = FILE_TYPES[contentType];
    if (!ext) throw new BadRequestException('Upload a PDF or a photo (JPG, PNG or WEBP)');
    if (!body.length) throw new BadRequestException('The file is empty');
    if (body.length > MAX_FILE) throw new PayloadTooLargeException('Documents must be 10MB or smaller');
    const existing = await this.tenantPrisma.run((tx) => this.permitRow(tx, projectId, type));
    const key = `construction/${organizationId}/projects/${projectId}/permits/${randomUUID()}.${ext}`;
    await this.storage.upload(key, body, contentType);
    await this.tenantPrisma.run(async (tx) => {
      await tx.conProjectPermit.update({ where: { id: existing.id }, data: { fileKey: key, fileType: contentType, fileName: fileName?.slice(0, 120) || `${PERMIT_LABELS[type]}.${ext}` } });
      await this.audit.logInTx(tx, { action: 'con_permit.file_uploaded', entityType: 'ConProjectPermit', entityId: existing.id, before: { fileKey: existing.fileKey }, after: { fileKey: key } });
    });
    if (existing.fileKey) await this.storage.delete(existing.fileKey);
    return { ok: true };
  }

  async permitFile(projectId: string, type: ConPermitType) {
    const p = await this.tenantPrisma.run((tx) => tx.conProjectPermit.findUnique({ where: { projectId_type: { projectId, type } } }));
    if (!p?.fileKey) throw new NotFoundException('No file has been uploaded for this permit');
    const { stream } = await this.storage.read(p.fileKey);
    return { stream, contentType: p.fileType ?? 'application/octet-stream', fileName: p.fileName ?? 'permit' };
  }

  // ── Programme ──

  async saveMilestone(projectId: string, dto: MilestoneDto, id?: string) {
    const { organizationId } = getTenantStore();
    if (dto.endDate < dto.startDate) throw new BadRequestException('A milestone cannot end before it starts.');
    return this.tenantPrisma.run(async (tx) => {
      await this.load(tx, projectId);
      const data = { name: dto.name.trim(), startDate: date(dto.startDate)!, endDate: date(dto.endDate)!, percentComplete: dto.percentComplete ?? 0, sortOrder: dto.sortOrder ?? 0 };
      if (!id) {
        const after = await tx.conMilestone.create({ data: { organizationId, projectId, ...data } });
        await this.audit.logInTx(tx, { action: 'con_milestone.created', entityType: 'ConMilestone', entityId: after.id, after });
        return after;
      }
      const before = await tx.conMilestone.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Milestone not found');
      const after = await tx.conMilestone.update({ where: { id }, data });
      await this.audit.logInTx(tx, { action: 'con_milestone.updated', entityType: 'ConMilestone', entityId: id, before, after });
      return after;
    });
  }

  async removeMilestone(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conMilestone.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Milestone not found');
      await tx.conMilestone.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_milestone.deleted', entityType: 'ConMilestone', entityId: id, before });
      return { ok: true };
    });
  }
}
