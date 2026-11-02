import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConRoleCode, Prisma, Role } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ResendEmailProvider } from '../../notifications/resend-email.provider';
import { tenantContext } from '../../common/tenant/tenant-context';
import { CommercialService } from '../commercial/commercial.service';
import { SubcontractsService } from '../commercial/subcontracts.service';
import { ConContext, canSeeAllProjects } from '../common/con-access';
import { constructionUrl } from '../common/con-domain';
import { todayKey } from '../compliance/compliance.util';
import { PortalCertifyDto, PortalDecisionDto, PortalInstructionDto, PortalSubValuationDto, PortalUserDto, PortalUserUpdateDto } from '../dto/payroll-portal.dto';
import { programmeProgress } from '../projects/projects.util';
import { SiteService } from '../site/site.service';
import { PortalCtx } from './portal-access';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const CLIENT: ConRoleCode = 'CON_CLIENT';
const ARCH: ConRoleCode = 'CON_CONSULTANT_ARCH';
const CQS: ConRoleCode = 'CON_CONSULTANT_QS';
const ENG: ConRoleCode = 'CON_CONSULTANT_ENG';
const SUB: ConRoleCode = 'CON_SUBCONTRACTOR';
const SEE_COMMERCIAL = [CLIENT, ARCH, CQS];
const SEE_SITE = [CLIENT, ARCH, CQS, ENG];
const ISSUE_INSTRUCTIONS = [ARCH, ENG];

/**
 * The external portal (docs/construction/01 s9, 02 external roles). Every call checks the project is one this person was
 * given, and returns only fields chosen here: never workers, materials, LPOs, plant, payroll or other internal costs.
 * Actions reuse the staff-side services, run in the builder's context with the portal user named in the audit log.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly commercial: CommercialService,
    private readonly subs: SubcontractsService,
    private readonly site: SiteService,
    private readonly email: ResendEmailProvider,
  ) {}

  private as<T>(p: PortalCtx, fn: () => Promise<T>): Promise<T> {
    return tenantContext.run({ organizationId: p.organizationId, orgUserId: `portal:${p.id}`, role: Role.CASHIER }, fn);
  }

  private con(p: PortalCtx): ConContext {
    return { organizationId: p.organizationId, orgUserId: `portal:${p.id}`, isOwner: false, companyRoles: [], projectRoles: [], plan: null as never, status: 'ACTIVE' };
  }

  /** A project this person was not given is "not found", the same as one that does not exist. */
  private check(p: PortalCtx, projectId: string, roles?: ConRoleCode[]) {
    if (!p.projectIds.includes(projectId)) throw new NotFoundException('Project not found');
    if (roles && !roles.includes(p.role)) throw new ForbiddenException('Your portal role cannot do this.');
  }

  me(p: PortalCtx) {
    return this.as(p, () =>
      this.tenantPrisma.run(async (tx) => {
        const org = await tx.organization.findUniqueOrThrow({ where: { id: p.organizationId }, select: { name: true, phone: true, email: true } });
        const projects = await tx.conProject.findMany({ where: { id: { in: p.projectIds } }, orderBy: { createdAt: 'desc' }, select: { id: true, code: true, name: true, status: true, location: true, county: true } });
        return { name: p.name, role: p.role, organization: org, projects };
      }),
    );
  }

  project(p: PortalCtx, projectId: string) {
    this.check(p, projectId);
    return this.as(p, () =>
      this.tenantPrisma.run(async (tx) => {
        const pr = await tx.conProject.findUniqueOrThrow({ where: { id: projectId }, include: { milestones: { orderBy: { sortOrder: 'asc' } }, client: { select: { name: true } } } });
        const money = p.role !== SUB;
        return {
          id: pr.id, code: pr.code, name: pr.name, status: pr.status, location: pr.location, county: pr.county, client: pr.client?.name ?? null,
          startDate: day(pr.startDate), completionDate: day(pr.completionDate), progress: programmeProgress(pr.milestones),
          contractSum: money ? n(pr.contractSum) : null, revisedSum: money && pr.revisedSum !== null ? n(pr.revisedSum) : null,
          milestones: pr.milestones.map((m) => ({ name: m.name, startDate: day(m.startDate), endDate: day(m.endDate), percentComplete: m.percentComplete })),
        };
      }),
    );
  }

  photos(p: PortalCtx, projectId: string) {
    this.check(p, projectId, SEE_SITE);
    return this.as(p, async () => {
      const rows = await this.tenantPrisma.run((tx) => tx.conSitePhoto.findMany({ where: { projectId }, orderBy: { takenAt: 'desc' }, take: 60, select: { id: true, caption: true, takenAt: true } }));
      return rows.map((r) => ({ id: r.id, caption: r.caption, takenAt: r.takenAt }));
    });
  }

  photoFile(p: PortalCtx, projectId: string, photoId: string) {
    this.check(p, projectId, SEE_SITE);
    return this.as(p, () => this.site.photoFile(projectId, photoId));
  }

  valuations(p: PortalCtx, projectId: string) {
    this.check(p, projectId, SEE_COMMERCIAL);
    return this.as(p, async () => {
      const rows = await this.tenantPrisma.run((tx) => tx.conValuation.findMany({ where: { projectId, status: { not: 'DRAFT' } }, orderBy: { number: 'desc' } }));
      return rows.map((v) => this.ipc(v));
    });
  }

  private ipc(v: Prisma.ConValuationGetPayload<object>) {
    return {
      id: v.id, number: v.number, kind: v.kind, status: v.status, reversed: v.reversed, periodEnd: day(v.periodEnd), workToDate: n(v.workToDate), variationsToDate: n(v.variationsToDate), materialsOnSite: n(v.materialsOnSite),
      grossToDate: n(v.grossToDate), retentionRate: n(v.retentionRate), retentionHeld: n(v.retentionHeld), advanceRecovery: n(v.advanceRecovery), previousCertified: n(v.previousCertified), netDue: n(v.netDue),
      vatAmount: v.vatAmount === null ? null : n(v.vatAmount), invoiceTotal: v.invoiceTotal === null ? null : n(v.invoiceTotal), certifiedByName: v.certifiedByName, certifiedRef: v.certifiedRef, certifiedAt: day(v.certifiedAt),
    };
  }

  valuation(p: PortalCtx, projectId: string, id: string) {
    this.check(p, projectId, SEE_COMMERCIAL);
    return this.as(p, async () => {
      const v = await this.commercial.getValuation(projectId, id);
      if (v.status === 'DRAFT') throw new NotFoundException('Valuation not found');
      return {
        id: v.id, number: v.number, kind: v.kind, status: v.status, reverses: v.reverses, periodEnd: v.periodEnd, notes: v.notes, certifiedByName: v.certifiedByName, certifiedRef: v.certifiedRef, certifiedAt: v.certifiedAt,
        workToDate: v.workToDate, variationsToDate: v.variationsToDate, materialsOnSite: v.materialsOnSite, grossToDate: v.grossToDate, retentionRate: v.retentionRate, retentionHeld: v.retentionHeld,
        advanceRecovery: v.advanceRecovery, previousCertified: v.previousCertified, netDue: v.netDue, vatRate: v.vatRate, vatAmount: v.vatAmount, invoiceTotal: v.invoiceTotal, lines: v.lines,
        project: { code: v.project.code, name: v.project.name, contractSum: v.project.contractSum, revisedSum: v.project.revisedSum, client: v.project.client?.name ?? null }, company: v.company,
        canCertify: p.role === CQS && v.status === 'SUBMITTED',
      };
    });
  }

  /** The client's QS certifies a valuation sent to them: it becomes the IPC, in their name, dated today. */
  certify(p: PortalCtx, projectId: string, id: string, dto: PortalCertifyDto) {
    this.check(p, projectId, [CQS]);
    return this.as(p, () => this.commercial.certify(this.con(p), projectId, id, { certifiedByName: p.name, certifiedRef: dto.certifiedRef, certifiedAt: todayKey() }));
  }

  variations(p: PortalCtx, projectId: string) {
    this.check(p, projectId, SEE_COMMERCIAL);
    return this.as(p, async () =>
      (await this.commercial.listVariations(projectId)).map((v) => ({ id: v.id, ref: v.ref, description: v.description, amount: v.amount, status: v.status, instruction: v.instruction?.number ?? null, approvedByName: v.approvedByName, approvedAt: v.approvedAt, rejectedReason: v.rejectedReason })),
    );
  }

  /** The client's architect approves or rejects a priced variation. */
  decideVariation(p: PortalCtx, projectId: string, id: string, dto: PortalDecisionDto) {
    this.check(p, projectId, [ARCH]);
    return this.as(p, async () => {
      const v = await this.commercial.decideVariation(this.con(p), projectId, id, { decision: dto.decision, approvedByName: p.name, reason: dto.reason });
      return { id: v.id, ref: v.ref, status: v.status };
    });
  }

  instructions(p: PortalCtx, projectId: string) {
    this.check(p, projectId, SEE_SITE);
    return this.as(p, async () => (await this.site.listInstructions(projectId)).map((i) => ({ id: i.id, number: i.number, date: i.date, issuedBy: i.issuedBy, description: i.description, status: i.status })));
  }

  /** The client's architect or engineer issues a site instruction straight from the portal. */
  addInstruction(p: PortalCtx, projectId: string, dto: PortalInstructionDto) {
    this.check(p, projectId, ISSUE_INSTRUCTIONS);
    return this.as(p, async () => {
      const i = await this.site.addInstruction(this.con(p), projectId, { date: todayKey(), description: dto.description, partyId: p.partyId ?? undefined, issuedByName: p.name });
      return { id: i.id, number: i.number };
    });
  }

  /** A subcontractor sees only their own subcontracts on the project: valuations, retention and payments. */
  subcontracts(p: PortalCtx, projectId: string) {
    this.check(p, projectId, [SUB]);
    return this.as(p, async () =>
      (await this.subs.list(projectId))
        .filter((s) => p.partyId && s.party.id === p.partyId)
        .map((s) => ({
          id: s.id, ref: s.ref, scope: s.scope, sum: s.sum, retentionRate: s.retentionRate, workToDate: s.workToDate, retentionHeld: s.retentionHeld, paid: s.paid, approvedUnpaid: s.approvedUnpaid,
          valuations: s.valuations.map((v) => ({ id: v.id, number: v.number, grossToDate: v.grossToDate, retention: v.retention, previousPaid: v.previousPaid, netDue: v.netDue, status: v.status, paymentRef: v.paymentRef, paidAt: v.paidAt, notes: v.notes })),
        })),
    );
  }

  /** A subcontractor submits their own valuation; the builder's QS / Contracts Manager approves it. */
  addSubValuation(p: PortalCtx, projectId: string, subcontractId: string, dto: PortalSubValuationDto) {
    this.check(p, projectId, [SUB]);
    return this.as(p, async () => {
      const own = await this.tenantPrisma.run((tx) => tx.conSubcontract.findFirst({ where: { id: subcontractId, projectId, partyId: p.partyId ?? '' } }));
      if (!own) throw new NotFoundException('Subcontract not found');
      const v = await this.subs.addValuation(this.con(p), projectId, subcontractId, { grossToDate: dto.grossToDate, notes: dto.notes });
      return { id: v.id, number: v.number, retention: n(v.retention), previousPaid: n(v.previousPaid), netDue: n(v.netDue), status: v.status };
    });
  }

  // ── Managed by the builder's staff ──

  async listUsers(con: ConContext) {
    const rows = await this.tenantPrisma.run((tx) => tx.conPortalUser.findMany({ orderBy: { name: 'asc' }, include: { access: { select: { projectId: true } }, party: { select: { id: true, name: true, kind: true } } } }));
    const visible = (ids: string[]) => (canSeeAllProjects(con) ? ids : ids.filter((id) => con.projectRoles.some((r) => r.projectId === id)));
    return rows
      .map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, isActive: u.isActive, party: u.party, lastLoginAt: u.lastLoginAt, projectIds: u.access.map((a) => a.projectId) }))
      .filter((u) => canSeeAllProjects(con) || visible(u.projectIds).length > 0);
  }

  private assertCanGrant(con: ConContext, projectIds: string[]) {
    if (canSeeAllProjects(con)) return;
    const bad = projectIds.find((id) => !con.projectRoles.some((r) => r.projectId === id && r.role === 'CON_PROJECT_MGR'));
    if (bad) throw new ForbiddenException('You can only give access to projects you manage.');
  }

  async invite(con: ConContext, dto: PortalUserDto) {
    this.assertCanGrant(con, dto.projectIds);
    const email = dto.email.trim().toLowerCase();
    const user = await this.tenantPrisma.run(async (tx) => {
      if (await tx.conPortalUser.findUnique({ where: { organizationId_email: { organizationId: con.organizationId, email } } })) throw new ConflictException(`${email} already has portal access - change their projects instead.`);
      if (dto.partyId) {
        const party = await tx.conParty.findUnique({ where: { id: dto.partyId } });
        if (!party) throw new NotFoundException('That party was not found');
        if (dto.role === SUB && party.kind !== 'SUBCONTRACTOR') throw new ConflictException(`${party.name} is not set up as a subcontractor.`);
      } else if (dto.role === SUB) throw new ConflictException('Pick which subcontractor this person works for.');
      const found = await tx.conProject.count({ where: { id: { in: dto.projectIds } } });
      if (found !== new Set(dto.projectIds).size) throw new NotFoundException('A project was not found');
      const u = await tx.conPortalUser.create({
        data: { organizationId: con.organizationId, name: dto.name.trim(), email, phone: dto.phone?.trim() || null, role: dto.role, partyId: dto.partyId ?? null, invitedBy: con.orgUserId, access: { create: dto.projectIds.map((projectId) => ({ organizationId: con.organizationId, projectId })) } },
      });
      await this.audit.logInTx(tx, { action: 'con_portal_user.invited', entityType: 'ConPortalUser', entityId: u.id, after: { name: u.name, email, role: u.role, projectIds: dto.projectIds } });
      const org = await tx.organization.findUniqueOrThrow({ where: { id: con.organizationId }, select: { name: true } });
      return { u, org: org.name };
    });
    const link = constructionUrl('/portal') ?? '/portal';
    await this.email
      .sendEmail({
        to: email,
        subject: `${user.org} has given you access to their project portal`,
        html: `<p>Hello ${escape(user.u.name)},</p><p>${escape(user.org)} has invited you to follow your project on their portal: progress, photos, valuations and more.</p><p><a href="${link}">Open the portal</a> and sign in with this email address. We will email you a code each time; there is no password.</p>`,
        text: `${user.org} has invited you to their project portal. Open ${link} and sign in with this email address.`,
      })
      .catch(() => undefined);
    return { id: user.u.id, name: user.u.name, email, role: user.u.role };
  }

  async updateUser(con: ConContext, id: string, dto: PortalUserUpdateDto) {
    if (dto.projectIds) this.assertCanGrant(con, dto.projectIds);
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conPortalUser.findUnique({ where: { id }, include: { access: true } });
      if (!before) throw new NotFoundException('Portal user not found');
      this.assertCanGrant(con, before.access.map((a) => a.projectId));
      if (dto.projectIds) {
        await tx.conPortalAccess.deleteMany({ where: { portalUserId: id } });
        await tx.conPortalAccess.createMany({ data: Array.from(new Set(dto.projectIds)).map((projectId) => ({ organizationId: con.organizationId, portalUserId: id, projectId })) });
      }
      const after = await tx.conPortalUser.update({ where: { id }, data: { isActive: dto.isActive ?? before.isActive } });
      await this.audit.logInTx(tx, { action: 'con_portal_user.updated', entityType: 'ConPortalUser', entityId: id, before: { isActive: before.isActive, projectIds: before.access.map((a) => a.projectId) }, after: { isActive: after.isActive, projectIds: dto.projectIds ?? before.access.map((a) => a.projectId) } });
      return { id, isActive: after.isActive };
    });
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
