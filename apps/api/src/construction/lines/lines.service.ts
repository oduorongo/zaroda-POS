import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PrivateObjectStorageService } from '../../common/storage/private-object-storage.service';
import { getTenantStore } from '../../common/tenant/tenant-context';
import { Tx } from '../common/con-access';
import { daysLeft, expiryState, todayKey } from '../compliance/compliance.util';
import { ClientItemDto, ClientMoveDto, CrossingDto, LineAssetDto, ProgressDto, SectionDto, StaffLicenceDto, WayleaveDto } from '../dto/lines.dto';
import { clientBalances, moveProblem, sectionProgress } from './lines.util';

const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s?: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/**
 * Power-line contractors (docs/construction/07): sections and daily progress, wayleaves, crossings, the as-built asset register,
 * client-supplied ("free-issue") materials and electricians' licences. Every change is audited.
 */
@Injectable()
export class LinesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  private async project(tx: Tx, projectId: string) {
    const p = await tx.conProject.findUnique({ where: { id: projectId }, select: { id: true, status: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async section(tx: Tx, projectId: string, sectionId?: string | null) {
    if (!sectionId) return null;
    const s = await tx.conProjectSection.findUnique({ where: { id: sectionId } });
    if (!s || s.projectId !== projectId) throw new BadRequestException('That section is not on this project');
    return s;
  }

  // ── Everything for the Power line tab ──

  async overview(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const today = todayKey();
      const [sections, progress, wayleaves, crossings, assets, items, moves] = await Promise.all([
        tx.conProjectSection.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
        tx.conSectionProgress.findMany({ where: { projectId }, orderBy: { date: 'desc' } }),
        tx.conWayleave.findMany({ where: { projectId }, orderBy: [{ chainageKm: { sort: 'asc', nulls: 'last' } }, { landowner: 'asc' }] }),
        tx.conCrossing.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
        tx.conLineAsset.findMany({ where: { projectId }, orderBy: [{ kind: 'asc' }, { tag: 'asc' }] }),
        tx.conClientItem.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
        tx.conClientMaterialMove.findMany({ where: { projectId }, orderBy: [{ moveDate: 'desc' }, { createdAt: 'desc' }] }),
      ]);
      const sectionCode = new Map(sections.map((s) => [s.id, s.code]));
      const balances = clientBalances(moves.map((m) => ({ itemId: m.itemId, kind: m.kind, quantity: Number(m.quantity) })));
      const entries = (sectionId: string) => progress.filter((p) => p.sectionId === sectionId).map((p) => ({ ...p, conductorKm: Number(p.conductorKm) }));
      const projectWide = sectionProgress(
        {
          targetPoles: sections.reduce((t, s) => t + s.targetPoles, 0),
          targetStays: sections.reduce((t, s) => t + s.targetStays, 0),
          targetConductorKm: sections.reduce((t, s) => t + Number(s.targetConductorKm), 0),
          targetTransformers: sections.reduce((t, s) => t + s.targetTransformers, 0),
          targetServices: sections.reduce((t, s) => t + s.targetServices, 0),
        },
        progress.map((p) => ({ ...p, conductorKm: Number(p.conductorKm) })),
      );
      return {
        progress: projectWide,
        sections: sections.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          fromKm: num(s.fromKm),
          toKm: num(s.toKm),
          targets: { poles: s.targetPoles, stays: s.targetStays, conductorKm: Number(s.targetConductorKm), transformers: s.targetTransformers, services: s.targetServices },
          ...sectionProgress(s, entries(s.id)),
          entries: entries(s.id).slice(0, 14).map((e) => ({ date: day(e.date), poles: e.poles, stays: e.stays, conductorKm: e.conductorKm, transformers: e.transformers, services: e.services, crew: e.crew, notes: e.notes })),
        })),
        wayleaves: {
          counts: { total: wayleaves.length, agreed: wayleaves.filter((w) => w.status === 'AGREED' || w.status === 'PAID').length, pending: wayleaves.filter((w) => w.status === 'PENDING').length, refused: wayleaves.filter((w) => w.status === 'REFUSED').length },
          compensation: wayleaves.reduce((t, w) => t + Number(w.compensation ?? 0), 0),
          rows: wayleaves.map((w) => ({ id: w.id, section: w.sectionId ? (sectionCode.get(w.sectionId) ?? null) : null, sectionId: w.sectionId, landowner: w.landowner, phone: w.phone, parcelNo: w.parcelNo, chainageKm: num(w.chainageKm), status: w.status, compensation: num(w.compensation), agreedAt: day(w.agreedAt), notes: w.notes, hasFile: !!w.fileKey })),
        },
        crossings: crossings.map((c) => {
          const expires = day(c.expiresAt);
          return { id: c.id, section: c.sectionId ? (sectionCode.get(c.sectionId) ?? null) : null, sectionId: c.sectionId, kind: c.kind, authority: c.authority, refNo: c.refNo, status: c.status, approvedAt: day(c.approvedAt), expiresAt: expires, state: expiryState(expires, today), daysLeft: expires ? daysLeft(expires, today) : null, notes: c.notes, hasFile: !!c.fileKey };
        }),
        assets: assets.map((a) => ({ id: a.id, section: a.sectionId ? (sectionCode.get(a.sectionId) ?? null) : null, sectionId: a.sectionId, kind: a.kind, tag: a.tag, serialNo: a.serialNo, spec: a.spec, lat: num(a.lat), lng: num(a.lng), installedAt: day(a.installedAt), note: a.note })),
        clientMaterials: {
          items: items.map((i) => ({ id: i.id, code: i.code, description: i.description, unit: i.unit, ...(balances.get(i.id) ?? { received: 0, issued: 0, returned: 0, damaged: 0, onHand: 0 }) })),
          moves: moves.slice(0, 50).map((m) => ({ id: m.id, itemId: m.itemId, kind: m.kind, quantity: Number(m.quantity), section: m.sectionId ? (sectionCode.get(m.sectionId) ?? null) : null, moveDate: day(m.moveDate), reference: m.reference, note: m.note })),
        },
      };
    });
  }

  // ── Sections and progress ──

  private sectionData(dto: SectionDto) {
    if (dto.fromKm !== undefined && dto.toKm !== undefined && dto.toKm < dto.fromKm) throw new BadRequestException('A section cannot end before it starts.');
    return {
      code: dto.code.toUpperCase(),
      name: dto.name,
      fromKm: dto.fromKm ?? null,
      toKm: dto.toKm ?? null,
      targetPoles: dto.targetPoles ?? 0,
      targetStays: dto.targetStays ?? 0,
      targetConductorKm: dto.targetConductorKm ?? 0,
      targetTransformers: dto.targetTransformers ?? 0,
      targetServices: dto.targetServices ?? 0,
    };
  }

  async saveSection(projectId: string, dto: SectionDto, id?: string) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const before = id ? await tx.conProjectSection.findUnique({ where: { id } }) : null;
      if (id && (!before || before.projectId !== projectId)) throw new NotFoundException('Section not found');
      const clash = await tx.conProjectSection.findUnique({ where: { projectId_code: { projectId, code: dto.code.toUpperCase() } } });
      if (clash && clash.id !== id) throw new ConflictException(`Section ${dto.code.toUpperCase()} already exists on this project`);
      const after = before
        ? await tx.conProjectSection.update({ where: { id: before.id }, data: this.sectionData(dto) })
        : await tx.conProjectSection.create({ data: { organizationId, projectId, ...this.sectionData(dto) } });
      await this.audit.logInTx(tx, { action: before ? 'con_section.updated' : 'con_section.created', entityType: 'ConProjectSection', entityId: after.id, before: before ?? undefined, after });
      return { id: after.id };
    });
  }

  /** A section's progress for one day (one entry per section per day; saving again replaces it). Not in the future. */
  async saveProgress(projectId: string, sectionId: string, onDate: string, dto: ProgressDto) {
    const { organizationId, orgUserId } = getTenantStore();
    if (onDate > todayKey()) throw new BadRequestException('Progress cannot be recorded for a future day.');
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId);
      if (p.status === 'CLOSED') throw new ConflictException('This project is closed.');
      await this.section(tx, projectId, sectionId);
      const data = { poles: dto.poles ?? 0, stays: dto.stays ?? 0, conductorKm: dto.conductorKm ?? 0, transformers: dto.transformers ?? 0, services: dto.services ?? 0, crew: dto.crew || null, notes: dto.notes || null };
      const before = await tx.conSectionProgress.findUnique({ where: { sectionId_date: { sectionId, date: date(onDate)! } } });
      const after = before
        ? await tx.conSectionProgress.update({ where: { id: before.id }, data })
        : await tx.conSectionProgress.create({ data: { organizationId, projectId, sectionId, date: date(onDate)!, createdBy: orgUserId, ...data } });
      await this.audit.logInTx(tx, { action: before ? 'con_progress.updated' : 'con_progress.created', entityType: 'ConSectionProgress', entityId: after.id, before: before ?? undefined, after });
      return { id: after.id };
    });
  }

  // ── Wayleaves and crossings ──

  async saveWayleave(projectId: string, dto: WayleaveDto, id?: string) {
    const { organizationId, orgUserId } = getTenantStore();
    if ((dto.status === 'AGREED' || dto.status === 'PAID') && !dto.agreedAt) throw new BadRequestException('Give the date the landowner agreed.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      await this.section(tx, projectId, dto.sectionId);
      const before = id ? await tx.conWayleave.findUnique({ where: { id } }) : null;
      if (id && (!before || before.projectId !== projectId)) throw new NotFoundException('Wayleave not found');
      const data = { sectionId: dto.sectionId ?? null, landowner: dto.landowner, phone: dto.phone || null, parcelNo: dto.parcelNo || null, chainageKm: dto.chainageKm ?? null, status: dto.status ?? 'PENDING', compensation: dto.compensation ?? null, agreedAt: date(dto.agreedAt), notes: dto.notes || null };
      const after = before ? await tx.conWayleave.update({ where: { id: before.id }, data }) : await tx.conWayleave.create({ data: { organizationId, projectId, createdBy: orgUserId, ...data } });
      await this.audit.logInTx(tx, { action: before ? 'con_wayleave.updated' : 'con_wayleave.created', entityType: 'ConWayleave', entityId: after.id, before: before ?? undefined, after });
      return { id: after.id };
    });
  }

  async saveCrossing(projectId: string, dto: CrossingDto, id?: string) {
    const { organizationId, orgUserId } = getTenantStore();
    if (dto.approvedAt && dto.expiresAt && dto.expiresAt < dto.approvedAt) throw new BadRequestException('It cannot expire before it was approved.');
    if (dto.status === 'APPROVED' && !dto.approvedAt) throw new BadRequestException('Give the date it was approved.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      await this.section(tx, projectId, dto.sectionId);
      const before = id ? await tx.conCrossing.findUnique({ where: { id } }) : null;
      if (id && (!before || before.projectId !== projectId)) throw new NotFoundException('Crossing not found');
      const data = { sectionId: dto.sectionId ?? null, kind: dto.kind, authority: dto.authority, refNo: dto.refNo || null, status: dto.status ?? 'PENDING', approvedAt: date(dto.approvedAt), expiresAt: date(dto.expiresAt), notes: dto.notes || null };
      const after = before ? await tx.conCrossing.update({ where: { id: before.id }, data }) : await tx.conCrossing.create({ data: { organizationId, projectId, createdBy: orgUserId, ...data } });
      await this.audit.logInTx(tx, { action: before ? 'con_crossing.updated' : 'con_crossing.created', entityType: 'ConCrossing', entityId: after.id, before: before ?? undefined, after });
      return { id: after.id };
    });
  }

  private async fileRow(tx: Tx, kind: 'wayleaves' | 'crossings', id: string) {
    const select = { projectId: true, fileKey: true, fileType: true, fileName: true } as const;
    if (kind === 'wayleaves') return tx.conWayleave.findUnique({ where: { id }, select });
    return tx.conCrossing.findUnique({ where: { id }, select });
  }

  /** The signed wayleave consent, or the crossing approval (PDF or photo, private). */
  async uploadFile(projectId: string, kind: 'wayleaves' | 'crossings', id: string, contentType: string, body: Buffer, fileName?: string) {
    const { organizationId } = getTenantStore();
    const ext = FILE_TYPES[contentType];
    if (!ext) throw new BadRequestException('Upload a PDF or a photo (JPG, PNG or WEBP)');
    if (!body.length) throw new BadRequestException('The file is empty');
    if (body.length > MAX_FILE) throw new PayloadTooLargeException('Documents must be 10MB or smaller');
    const row = await this.tenantPrisma.run((tx) => this.fileRow(tx, kind, id));
    if (!row || row.projectId !== projectId) throw new NotFoundException('Not found');
    const key = `construction/${organizationId}/projects/${projectId}/${kind}/${randomUUID()}.${ext}`;
    await this.storage.upload(key, body, contentType);
    const data = { fileKey: key, fileType: contentType, fileName: fileName?.slice(0, 120) || `${kind === 'wayleaves' ? 'wayleave' : 'crossing'}.${ext}` };
    await this.tenantPrisma.run(async (tx) => {
      if (kind === 'wayleaves') await tx.conWayleave.update({ where: { id }, data });
      else await tx.conCrossing.update({ where: { id }, data });
      await this.audit.logInTx(tx, { action: `con_${kind === 'wayleaves' ? 'wayleave' : 'crossing'}.file_uploaded`, entityType: kind === 'wayleaves' ? 'ConWayleave' : 'ConCrossing', entityId: id, before: { fileKey: row.fileKey }, after: { fileKey: key } });
    });
    if (row.fileKey) await this.storage.delete(row.fileKey);
    return { ok: true };
  }

  async file(projectId: string, kind: 'wayleaves' | 'crossings', id: string) {
    const row = await this.tenantPrisma.run((tx) => this.fileRow(tx, kind, id));
    if (!row || row.projectId !== projectId || !row.fileKey) throw new NotFoundException('No file has been uploaded');
    const { stream } = await this.storage.read(row.fileKey);
    return { stream, contentType: row.fileType ?? 'application/octet-stream', fileName: row.fileName ?? 'document' };
  }

  // ── As-built assets ──

  async saveAsset(projectId: string, dto: LineAssetDto, id?: string) {
    const { organizationId, orgUserId } = getTenantStore();
    if ((dto.lat === undefined) !== (dto.lng === undefined)) throw new BadRequestException('Give both the latitude and the longitude, or neither.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      await this.section(tx, projectId, dto.sectionId);
      const before = id ? await tx.conLineAsset.findUnique({ where: { id } }) : null;
      if (id && (!before || before.projectId !== projectId)) throw new NotFoundException('Asset not found');
      const clash = await tx.conLineAsset.findUnique({ where: { projectId_kind_tag: { projectId, kind: dto.kind, tag: dto.tag.toUpperCase() } } });
      if (clash && clash.id !== id) throw new ConflictException(`${dto.kind.toLowerCase()} ${dto.tag.toUpperCase()} is already recorded on this project`);
      const data = { sectionId: dto.sectionId ?? null, kind: dto.kind, tag: dto.tag.toUpperCase(), serialNo: dto.serialNo || null, spec: dto.spec || null, lat: dto.lat ?? null, lng: dto.lng ?? null, installedAt: date(dto.installedAt), note: dto.note || null };
      const after = before ? await tx.conLineAsset.update({ where: { id: before.id }, data }) : await tx.conLineAsset.create({ data: { organizationId, projectId, createdBy: orgUserId, ...data } });
      await this.audit.logInTx(tx, { action: before ? 'con_line_asset.updated' : 'con_line_asset.created', entityType: 'ConLineAsset', entityId: after.id, before: before ?? undefined, after });
      return { id: after.id };
    });
  }

  async removeAsset(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conLineAsset.findUnique({ where: { id } });
      if (!before || before.projectId !== projectId) throw new NotFoundException('Asset not found');
      await tx.conLineAsset.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_line_asset.deleted', entityType: 'ConLineAsset', entityId: id, before });
      return { ok: true };
    });
  }

  // ── Client-supplied materials ──

  /** The items with what is on hand, the recent movements and the sections (for issuing), for the store screens. */
  async clientMaterials(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const [items, moves, sections] = await Promise.all([
        tx.conClientItem.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
        tx.conClientMaterialMove.findMany({ where: { projectId }, orderBy: [{ moveDate: 'desc' }, { createdAt: 'desc' }] }),
        tx.conProjectSection.findMany({ where: { projectId }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
      ]);
      const code = new Map(sections.map((x) => [x.id, x.code]));
      const balances = clientBalances(moves.map((m) => ({ itemId: m.itemId, kind: m.kind, quantity: Number(m.quantity) })));
      return {
        sections,
        items: items.map((i) => ({ id: i.id, code: i.code, description: i.description, unit: i.unit, ...(balances.get(i.id) ?? { received: 0, issued: 0, returned: 0, damaged: 0, onHand: 0 }) })),
        moves: moves.slice(0, 50).map((m) => ({ id: m.id, itemId: m.itemId, kind: m.kind, quantity: Number(m.quantity), section: m.sectionId ? (code.get(m.sectionId) ?? null) : null, moveDate: day(m.moveDate), reference: m.reference, note: m.note })),
      };
    });
  }

  async addClientItem(projectId: string, dto: ClientItemDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      if (await tx.conClientItem.findUnique({ where: { projectId_code: { projectId, code: dto.code.toUpperCase() } } })) throw new ConflictException(`Item ${dto.code.toUpperCase()} is already on this project`);
      const after = await tx.conClientItem.create({ data: { organizationId, projectId, code: dto.code.toUpperCase(), description: dto.description, unit: dto.unit } });
      await this.audit.logInTx(tx, { action: 'con_client_item.created', entityType: 'ConClientItem', entityId: after.id, after });
      return { id: after.id };
    });
  }

  /** Received from the client, issued to the works, returned, or written off as damaged. Never more out than is on hand. */
  async addClientMove(projectId: string, dto: ClientMoveDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const on = dto.moveDate ?? todayKey();
    if (on > todayKey()) throw new BadRequestException('A movement cannot be dated in the future.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'con-client-item:' + dto.itemId}))`;
      const item = await tx.conClientItem.findUnique({ where: { id: dto.itemId } });
      if (!item || item.projectId !== projectId) throw new BadRequestException('That item is not on this project');
      if (dto.sectionId && dto.kind !== 'ISSUED') throw new BadRequestException('Only an issue to the works goes to a section.');
      await this.section(tx, projectId, dto.sectionId);
      const moves = await tx.conClientMaterialMove.findMany({ where: { itemId: item.id }, select: { itemId: true, kind: true, quantity: true } });
      const onHand = clientBalances(moves.map((m) => ({ ...m, quantity: Number(m.quantity) }))).get(item.id)?.onHand ?? 0;
      const problem = moveProblem(dto.kind, dto.quantity, onHand);
      if (problem) throw new BadRequestException(problem);
      const after = await tx.conClientMaterialMove.create({
        data: { organizationId, projectId, itemId: item.id, kind: dto.kind, quantity: dto.quantity, sectionId: dto.sectionId ?? null, moveDate: date(on)!, reference: dto.reference || null, note: dto.note || null, createdBy: orgUserId },
      });
      await this.audit.logInTx(tx, { action: 'con_client_move.created', entityType: 'ConClientMaterialMove', entityId: after.id, after });
      return { id: after.id };
    });
  }

  /** Takes back a movement entered by mistake, as long as the item would not then be short. */
  async removeClientMove(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conClientMaterialMove.findUnique({ where: { id } });
      if (!before || before.projectId !== projectId) throw new NotFoundException('Movement not found');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'con-client-item:' + before.itemId}))`;
      const rest = await tx.conClientMaterialMove.findMany({ where: { itemId: before.itemId, id: { not: id } }, select: { itemId: true, kind: true, quantity: true } });
      if ((clientBalances(rest.map((m) => ({ ...m, quantity: Number(m.quantity) }))).get(before.itemId)?.onHand ?? 0) < 0) throw new BadRequestException('Removing this receipt would leave more issued than received. Remove the issues first.');
      await tx.conClientMaterialMove.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_client_move.deleted', entityType: 'ConClientMaterialMove', entityId: id, before });
      return { ok: true };
    });
  }

  // ── Electricians' licences ──

  async listStaffLicences() {
    return this.tenantPrisma.run(async (tx) => {
      const today = todayKey();
      const rows = await tx.conStaffLicence.findMany({ orderBy: { expiresAt: 'asc' } });
      const names = new Map((await tx.orgUser.findMany({ where: { id: { in: rows.map((r) => r.orgUserId) } }, select: { id: true, user: { select: { fullName: true } } } })).map((u) => [u.id, u.user.fullName]));
      return rows.map((r) => {
        const expires = day(r.expiresAt)!;
        return { id: r.id, orgUserId: r.orgUserId, name: names.get(r.orgUserId) ?? 'Former staff', body: r.body, licenceClass: r.licenceClass, licenceNo: r.licenceNo, expiresAt: expires, state: expiryState(expires, today), daysLeft: daysLeft(expires, today) };
      });
    });
  }

  async saveStaffLicence(dto: StaffLicenceDto, id?: string) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.orgUser.findUnique({ where: { id: dto.orgUserId } }))) throw new BadRequestException('That person is not on your staff');
      const before = id ? await tx.conStaffLicence.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Licence not found');
      const data = { orgUserId: dto.orgUserId, body: dto.body?.toUpperCase() || 'EPRA', licenceClass: dto.licenceClass, licenceNo: dto.licenceNo, expiresAt: date(dto.expiresAt)! };
      const after = before ? await tx.conStaffLicence.update({ where: { id: before.id }, data }) : await tx.conStaffLicence.create({ data: { organizationId, createdBy: orgUserId, ...data } });
      await this.audit.logInTx(tx, { action: before ? 'con_staff_licence.updated' : 'con_staff_licence.created', entityType: 'ConStaffLicence', entityId: after.id, before: before ?? undefined, after });
      return { id: after.id };
    });
  }

  async removeStaffLicence(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conStaffLicence.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Licence not found');
      await tx.conStaffLicence.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_staff_licence.deleted', entityType: 'ConStaffLicence', entityId: id, before });
      return { ok: true };
    });
  }
}
