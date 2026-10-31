import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConSiteDiary } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PrivateObjectStorageService } from '../../common/storage/private-object-storage.service';
import { ConContext, Tx, hasRole } from '../common/con-access';
import { todayKey } from '../compliance/compliance.util';
import { DiaryDto, InstructionDto } from '../dto/site.dto';
import { nextCode } from '../projects/projects.util';
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from './site.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const photoView = (p: { id: string; caption: string | null; takenAt: Date; lat: unknown; lng: unknown }) => ({ id: p.id, caption: p.caption, takenAt: p.takenAt, lat: p.lat === null ? null : Number(p.lat), lng: p.lng === null ? null : Number(p.lng) });

/** The site diary (one per project per day), its photos, and site instructions from the consultants. */
@Injectable()
export class SiteService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  private async project(tx: Tx, projectId: string) {
    const p = await tx.conProject.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private diaryView(d: ConSiteDiary, present: number, photos: { id: string; caption: string | null; takenAt: Date; lat: unknown; lng: unknown }[]) {
    return {
      id: d.id,
      date: day(d.date),
      weather: d.weather,
      worksDone: d.worksDone,
      delays: d.delays,
      visitors: d.visitors,
      plantOnSite: d.plantOnSite,
      labourCount: d.labourCount ?? present,
      labourFromMuster: present,
      status: d.status,
      approvedAt: d.approvedAt,
      photos: photos.map(photoView),
    };
  }

  async listDiaries(projectId: string, from?: string, to?: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const rows = await tx.conSiteDiary.findMany({
        where: { projectId, ...(from || to ? { date: { ...(from ? { gte: date(from) } : {}), ...(to ? { lte: date(to) } : {}) } } : {}) },
        orderBy: { date: 'desc' },
        take: 60,
        include: { _count: { select: { photos: true } } },
      });
      return rows.map((d) => ({ id: d.id, date: day(d.date), weather: d.weather, worksDone: d.worksDone, labourCount: d.labourCount, status: d.status, photos: d._count.photos }));
    });
  }

  async getDiary(projectId: string, dayKey: string) {
    if (!isDay(dayKey)) throw new BadRequestException('Use a date like 2026-10-30');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const d = date(dayKey);
      const [diary, present, photos] = await Promise.all([
        tx.conSiteDiary.findUnique({ where: { projectId_date: { projectId, date: d } } }),
        tx.conMuster.count({ where: { projectId, date: d, status: { in: ['PRESENT', 'HALF'] } } }),
        tx.conSitePhoto.findMany({ where: { projectId, takenAt: { gte: d, lt: new Date(d.getTime() + 86_400_000) } }, orderBy: { takenAt: 'asc' } }),
      ]);
      if (!diary) return { id: null, date: dayKey, weather: null, worksDone: null, delays: null, visitors: null, plantOnSite: null, labourCount: present, labourFromMuster: present, status: 'DRAFT' as const, approvedAt: null, photos: photos.map(photoView) };
      return this.diaryView(diary, present, photos);
    });
  }

  private async ensureDiary(tx: Tx, con: ConContext, projectId: string, dayKey: string) {
    const d = date(dayKey);
    return (
      (await tx.conSiteDiary.findUnique({ where: { projectId_date: { projectId, date: d } } })) ??
      tx.conSiteDiary.create({ data: { organizationId: con.organizationId, projectId, date: d, createdBy: con.orgUserId } })
    );
  }

  async saveDiary(con: ConContext, projectId: string, dayKey: string, dto: DiaryDto) {
    if (!isDay(dayKey)) throw new BadRequestException('Use a date like 2026-10-30');
    if (dayKey > todayKey()) throw new BadRequestException('A diary cannot be written for a future day.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const before = await this.ensureDiary(tx, con, projectId, dayKey);
      if (before.status === 'APPROVED') throw new ConflictException('This diary has been approved and is locked.');
      const clean = (s?: string) => s?.trim() || null;
      const after = await tx.conSiteDiary.update({
        where: { id: before.id },
        data: { weather: clean(dto.weather), worksDone: clean(dto.worksDone), delays: clean(dto.delays), visitors: clean(dto.visitors), plantOnSite: clean(dto.plantOnSite), labourCount: dto.labourCount ?? null },
      });
      await this.audit.logInTx(tx, { action: 'con_diary.saved', entityType: 'ConSiteDiary', entityId: after.id, before, after });
      return { id: after.id, status: after.status };
    });
  }

  /** Submitted by the site; approved (and locked) by the Project Manager. */
  async setDiaryStatus(con: ConContext, projectId: string, dayKey: string, action: 'submit' | 'approve') {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conSiteDiary.findUnique({ where: { projectId_date: { projectId, date: date(dayKey) } } });
      if (!before) throw new NotFoundException('There is no diary for that day yet.');
      if (before.status === 'APPROVED') throw new ConflictException('This diary is already approved.');
      if (action === 'approve' && !hasRole(con, ['CON_PROJECT_MGR'], projectId)) throw new ForbiddenException('Only the Project Manager approves the site diary.');
      const after = await tx.conSiteDiary.update({
        where: { id: before.id },
        data: action === 'approve' ? { status: 'APPROVED', approvedBy: con.orgUserId, approvedAt: new Date() } : { status: 'SUBMITTED' },
      });
      await this.audit.logInTx(tx, { action: `con_diary.${action === 'approve' ? 'approved' : 'submitted'}`, entityType: 'ConSiteDiary', entityId: after.id, before: { status: before.status }, after: { status: after.status } });
      return { id: after.id, status: after.status };
    });
  }

  // ── Photos ──

  async uploadPhoto(con: ConContext, projectId: string, contentType: string, body: Buffer, meta: { caption?: string; lat?: string; lng?: string; takenAt?: string }) {
    const ext = PHOTO_TYPES[contentType];
    if (!ext) throw new BadRequestException('Upload a photo (JPG, PNG or WEBP)');
    if (!body.length) throw new BadRequestException('The photo is empty');
    const looksRight = contentType === 'image/jpeg' ? body[0] === 0xff && body[1] === 0xd8 : contentType === 'image/png' ? body.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) : body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP';
    if (!looksRight) throw new BadRequestException('That file is not a photo - take or choose the picture again.');
    if (body.length > MAX_PHOTO_BYTES) throw new PayloadTooLargeException('Photos must be 8MB or smaller');
    const takenAt = meta.takenAt && !Number.isNaN(Date.parse(meta.takenAt)) ? new Date(meta.takenAt) : new Date();
    if (takenAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('The photo time is in the future.');
    const coord = (v: string | undefined, max: number) => {
      const n = v === undefined || v === '' ? null : Number(v);
      return n === null || !Number.isFinite(n) || Math.abs(n) > max ? null : n;
    };
    const dayKey = new Date(takenAt.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
    const diary = await this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const d = await this.ensureDiary(tx, con, projectId, dayKey);
      if (d.status === 'APPROVED') throw new ConflictException(`The diary for ${dayKey} is approved and locked.`);
      return d;
    });
    const key = `construction/${con.organizationId}/projects/${projectId}/photos/${randomUUID()}.${ext}`;
    await this.storage.upload(key, body, contentType);
    return this.tenantPrisma.run(async (tx) => {
      const photo = await tx.conSitePhoto.create({
        data: { organizationId: con.organizationId, projectId, diaryId: diary.id, fileKey: key, fileType: contentType, caption: meta.caption?.trim().slice(0, 200) || null, lat: coord(meta.lat, 90), lng: coord(meta.lng, 180), takenAt, uploadedBy: con.orgUserId },
      });
      await this.audit.logInTx(tx, { action: 'con_photo.uploaded', entityType: 'ConSitePhoto', entityId: photo.id, after: { ...photo, fileKey: undefined } });
      return { id: photo.id, date: dayKey, caption: photo.caption, lat: photo.lat === null ? null : Number(photo.lat), lng: photo.lng === null ? null : Number(photo.lng), takenAt: photo.takenAt };
    });
  }

  async listPhotos(projectId: string, limit = 60) {
    const rows = await this.tenantPrisma.run((tx) => tx.conSitePhoto.findMany({ where: { projectId }, orderBy: { takenAt: 'desc' }, take: Math.min(limit, 200) }));
    return rows.map(photoView);
  }

  async photoFile(projectId: string, id: string) {
    const p = await this.tenantPrisma.run((tx) => tx.conSitePhoto.findFirst({ where: { id, projectId } }));
    if (!p) throw new NotFoundException('Photo not found');
    const { stream } = await this.storage.read(p.fileKey);
    return { stream, contentType: p.fileType };
  }

  async removePhoto(con: ConContext, projectId: string, id: string) {
    const before = await this.tenantPrisma.run(async (tx) => {
      const p = await tx.conSitePhoto.findFirst({ where: { id, projectId }, include: { diary: true } });
      if (!p) throw new NotFoundException('Photo not found');
      if (p.diary?.status === 'APPROVED') throw new ConflictException('The diary for this photo is approved and locked.');
      if (p.uploadedBy !== con.orgUserId && !hasRole(con, ['CON_PROJECT_MGR'], projectId)) throw new ForbiddenException('Only whoever took the photo, or the Project Manager, can remove it.');
      await tx.conSitePhoto.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_photo.deleted', entityType: 'ConSitePhoto', entityId: id, before: { ...p, diary: undefined } });
      return p;
    });
    await this.storage.delete(before.fileKey);
    return { ok: true };
  }

  // ── Site instructions ──

  async listInstructions(projectId: string) {
    const rows = await this.tenantPrisma.run((tx) => tx.conSiteInstruction.findMany({ where: { projectId }, orderBy: { date: 'desc' }, include: { party: { select: { id: true, name: true, kind: true } } } }));
    return rows.map((i) => ({ id: i.id, number: i.number, date: day(i.date), issuedBy: i.party?.name ?? i.issuedByName, party: i.party, description: i.description, status: i.status, variationId: i.variationId }));
  }

  async addInstruction(con: ConContext, projectId: string, dto: InstructionDto) {
    if (dto.date > todayKey()) throw new BadRequestException('An instruction cannot be dated in the future.');
    if (!dto.partyId && !dto.issuedByName?.trim()) throw new BadRequestException('Say who issued the instruction.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      if (dto.partyId && !(await tx.conParty.findUnique({ where: { id: dto.partyId } }))) throw new NotFoundException('That consultant was not found');
      const numbers = (await tx.conSiteInstruction.findMany({ where: { projectId }, select: { number: true } })).map((n) => n.number);
      const after = await tx.conSiteInstruction.create({
        data: { organizationId: con.organizationId, projectId, number: nextCode('SI', numbers), partyId: dto.partyId ?? null, issuedByName: dto.issuedByName?.trim() || null, date: date(dto.date), description: dto.description.trim(), createdBy: con.orgUserId },
      });
      await this.audit.logInTx(tx, { action: 'con_instruction.created', entityType: 'ConSiteInstruction', entityId: after.id, after });
      return after;
    });
  }

  async setInstructionStatus(projectId: string, id: string, status: 'OPEN' | 'ACTIONED' | 'CLOSED') {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conSiteInstruction.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Instruction not found');
      const after = await tx.conSiteInstruction.update({ where: { id }, data: { status } });
      await this.audit.logInTx(tx, { action: 'con_instruction.status_changed', entityType: 'ConSiteInstruction', entityId: id, before: { status: before.status }, after: { status } });
      return after;
    });
  }
}
