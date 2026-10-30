import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConCategoryLimit, ConComplianceDoc, ConCompanyRegistration, ConTaxSetting, ConWorksClass } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PrivateObjectStorageService } from '../../common/storage/private-object-storage.service';
import { getTenantStore } from '../../common/tenant/tenant-context';
import { Tx } from '../common/con-access';
import { CategoryLimitDto, ComplianceDocDto, RegistrationDto, TaxSettingDto } from '../dto/construction.dto';
import { DOC_LABELS, REQUIRED_DOCS, WORKS_CLASS_LABELS, capCheck, complianceHealth, daysLeft, expiryState, todayKey } from './compliance.util';

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s?: string) => (s ? new Date(`${s}T00:00:00Z`) : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function looksLike(type: string, b: Buffer) {
  if (type === 'application/pdf') return b.subarray(0, 5).toString('ascii') === '%PDF-';
  if (type === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8;
  if (type === 'image/png') return b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (type === 'image/webp') return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

/** The compliance vault (docs/construction/04): NCA registrations, expiring documents with private files, NCA caps and tax settings. */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  // ── NCA registrations ──

  private regView(r: ConCompanyRegistration, today = todayKey()) {
    const expires = day(r.licenceExpiresAt);
    return {
      id: r.id,
      worksClass: r.worksClass,
      worksClassLabel: WORKS_CLASS_LABELS[r.worksClass],
      ncaCategory: r.ncaCategory,
      regNo: r.regNo,
      registeredAt: day(r.registeredAt),
      licenceExpiresAt: expires,
      state: expiryState(expires, today),
      daysLeft: expires ? daysLeft(expires, today) : null,
    };
  }

  async listRegistrations() {
    const rows = await this.tenantPrisma.run((tx) => tx.conCompanyRegistration.findMany({ orderBy: { worksClass: 'asc' } }));
    return rows.map((r) => this.regView(r));
  }

  async saveRegistration(dto: RegistrationDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const row = await this.tenantPrisma.run(async (tx) => {
      const before = await tx.conCompanyRegistration.findUnique({ where: { organizationId_worksClass: { organizationId, worksClass: dto.worksClass } } });
      const data = { ncaCategory: dto.ncaCategory, regNo: dto.regNo.trim(), registeredAt: date(dto.registeredAt), licenceExpiresAt: date(dto.licenceExpiresAt) };
      const after = before
        ? await tx.conCompanyRegistration.update({ where: { id: before.id }, data })
        : await tx.conCompanyRegistration.create({ data: { organizationId, worksClass: dto.worksClass, createdBy: orgUserId, ...data } });
      await this.audit.logInTx(tx, { action: before ? 'con_registration.updated' : 'con_registration.created', entityType: 'ConCompanyRegistration', entityId: after.id, before: before ?? undefined, after });
      return after;
    });
    return this.regView(row);
  }

  async removeRegistration(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conCompanyRegistration.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Registration not found');
      await tx.conCompanyRegistration.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_registration.deleted', entityType: 'ConCompanyRegistration', entityId: id, before });
      return { ok: true };
    });
  }

  // ── Documents ──

  private docView(d: ConComplianceDoc, today = todayKey()) {
    const expires = day(d.expiresAt);
    return {
      id: d.id,
      type: d.type,
      typeLabel: DOC_LABELS[d.type],
      title: d.title,
      refNo: d.refNo,
      issuedAt: day(d.issuedAt),
      expiresAt: expires,
      projectId: d.projectId,
      notes: d.notes,
      hasFile: !!d.fileKey,
      fileName: d.fileName,
      state: expiryState(expires, today),
      daysLeft: expires ? daysLeft(expires, today) : null,
      updatedAt: d.updatedAt,
    };
  }

  async listDocs() {
    const rows = await this.tenantPrisma.run((tx) => tx.conComplianceDoc.findMany({ orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }] }));
    return rows.map((d) => this.docView(d));
  }

  private docData(dto: ComplianceDocDto) {
    if (dto.issuedAt && dto.expiresAt && dto.expiresAt < dto.issuedAt) throw new BadRequestException('It cannot expire before it was issued.');
    return { type: dto.type, title: dto.title.trim(), refNo: dto.refNo?.trim() || null, issuedAt: date(dto.issuedAt), expiresAt: date(dto.expiresAt), projectId: dto.projectId ?? null, notes: dto.notes?.trim() || null };
  }

  async createDoc(dto: ComplianceDocDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const row = await this.tenantPrisma.run(async (tx) => {
      const after = await tx.conComplianceDoc.create({ data: { organizationId, createdBy: orgUserId, ...this.docData(dto) } });
      await this.audit.logInTx(tx, { action: 'con_doc.created', entityType: 'ConComplianceDoc', entityId: after.id, after });
      return after;
    });
    return this.docView(row);
  }

  async updateDoc(id: string, dto: ComplianceDocDto) {
    const row = await this.tenantPrisma.run(async (tx) => {
      const before = await tx.conComplianceDoc.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Document not found');
      const after = await tx.conComplianceDoc.update({ where: { id }, data: this.docData(dto) });
      await this.audit.logInTx(tx, { action: 'con_doc.updated', entityType: 'ConComplianceDoc', entityId: id, before, after });
      return after;
    });
    return this.docView(row);
  }

  async removeDoc(id: string) {
    const before = await this.tenantPrisma.run(async (tx) => {
      const found = await tx.conComplianceDoc.findUnique({ where: { id } });
      if (!found) throw new NotFoundException('Document not found');
      await tx.conComplianceDoc.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_doc.deleted', entityType: 'ConComplianceDoc', entityId: id, before: found });
      return found;
    });
    if (before.fileKey) await this.storage.delete(before.fileKey);
    return { ok: true };
  }

  async uploadFile(id: string, contentType: string, body: Buffer, fileName?: string) {
    const { organizationId } = getTenantStore();
    const ext = FILE_TYPES[contentType];
    if (!ext) throw new BadRequestException('Upload a PDF or a photo (JPG, PNG or WEBP)');
    if (body.length === 0) throw new BadRequestException('The file is empty');
    if (body.length > MAX_DOC_BYTES) throw new PayloadTooLargeException('Documents must be 10MB or smaller');
    if (!looksLike(contentType, body)) throw new BadRequestException('That file is not what it says it is - upload the original PDF or photo');
    const existing = await this.tenantPrisma.run((tx) => tx.conComplianceDoc.findUnique({ where: { id } }));
    if (!existing) throw new NotFoundException('Document not found');
    const key = `construction/${organizationId}/compliance/${id}/${randomUUID()}.${ext}`;
    await this.storage.upload(key, body, contentType);
    const row = await this.tenantPrisma.run(async (tx) => {
      const after = await tx.conComplianceDoc.update({ where: { id }, data: { fileKey: key, fileType: contentType, fileName: fileName?.slice(0, 120) || `${existing.title}.${ext}` } });
      await this.audit.logInTx(tx, { action: 'con_doc.file_uploaded', entityType: 'ConComplianceDoc', entityId: id, before: { fileKey: existing.fileKey }, after: { fileKey: key, fileType: contentType } });
      return after;
    });
    if (existing.fileKey) await this.storage.delete(existing.fileKey);
    return this.docView(row);
  }

  async download(id: string) {
    const doc = await this.tenantPrisma.run((tx) => tx.conComplianceDoc.findUnique({ where: { id } }));
    if (!doc?.fileKey) throw new NotFoundException('No file has been uploaded for this document');
    const { stream } = await this.storage.read(doc.fileKey);
    return { stream, contentType: doc.fileType ?? 'application/octet-stream', fileName: doc.fileName ?? 'document' };
  }

  // ── Health ──

  async health() {
    const today = todayKey();
    const { docs, regs } = await this.tenantPrisma.run(async (tx) => ({
      docs: await tx.conComplianceDoc.findMany({ where: { projectId: null } }),
      regs: await tx.conCompanyRegistration.findMany(),
    }));
    const items = [
      ...docs.map((d) => ({ kind: 'DOC' as const, id: d.id, name: d.title, type: d.type, expiresAt: day(d.expiresAt) })),
      ...regs.map((r) => ({ kind: 'REGISTRATION' as const, id: r.id, name: `NCA${r.ncaCategory} ${WORKS_CLASS_LABELS[r.worksClass]} licence`, type: null, expiresAt: day(r.licenceExpiresAt) })),
    ].map((i) => ({ ...i, state: expiryState(i.expiresAt, today), daysLeft: i.expiresAt ? daysLeft(i.expiresAt, today) : null }));
    const missing = REQUIRED_DOCS.filter((t) => !docs.some((d) => d.type === t));
    const count = (s: string) => items.filter((i) => i.state === s).length;
    return {
      health: complianceHealth(items.map((i) => i.state), missing.length + (regs.length === 0 ? 1 : 0)),
      counts: { ok: count('OK'), expiring: count('EXPIRING'), expired: count('EXPIRED'), noExpiry: count('NO_EXPIRY') },
      missing: [...(regs.length === 0 ? ['NCA registration'] : []), ...missing.map((t) => DOC_LABELS[t])],
      attention: items.filter((i) => i.state === 'EXPIRED' || i.state === 'EXPIRING').sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)).slice(0, 6),
    };
  }

  // ── NCA caps ──

  private limitView = (l: ConCategoryLimit) => ({ id: l.id, worksClass: l.worksClass, ncaCategory: l.ncaCategory, maxValue: num(l.maxValue) });

  async listLimits() {
    const rows = await this.tenantPrisma.run((tx) => tx.conCategoryLimit.findMany({ orderBy: [{ worksClass: 'asc' }, { ncaCategory: 'asc' }] }));
    return rows.map(this.limitView);
  }

  async updateLimit(id: string, dto: CategoryLimitDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conCategoryLimit.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Cap not found');
      const after = await tx.conCategoryLimit.update({ where: { id }, data: { maxValue: dto.maxValue } });
      await this.audit.logInTx(tx, { action: 'con_category_limit.updated', entityType: 'ConCategoryLimit', entityId: id, before, after });
      return this.limitView(after);
    });
  }

  /** Whether the firm may take on work of this value in this works class. Used by tenders/projects (C2). */
  async capCheckIn(tx: Tx, organizationId: string, worksClass: ConWorksClass, value: number) {
    const reg = await tx.conCompanyRegistration.findUnique({ where: { organizationId_worksClass: { organizationId, worksClass } } });
    const cap = reg ? await tx.conCategoryLimit.findUnique({ where: { organizationId_worksClass_ncaCategory: { organizationId, worksClass, ncaCategory: reg.ncaCategory } } }) : null;
    return { ...capCheck(value, num(cap?.maxValue), reg?.ncaCategory ?? null, worksClass), ncaCategory: reg?.ncaCategory ?? null, cap: num(cap?.maxValue) };
  }

  capCheck(worksClass: ConWorksClass, value: number) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) => this.capCheckIn(tx, organizationId, worksClass, value));
  }

  // ── Tax settings ──

  private taxView = (t: ConTaxSetting) => ({ id: t.id, key: t.key, rate: Number(t.rate), threshold: num(t.threshold), active: t.active, effectiveFrom: day(t.effectiveFrom), notes: t.notes, createdAt: t.createdAt });

  async listTaxSettings() {
    const today = todayKey();
    const rows = (await this.tenantPrisma.run((tx) => tx.conTaxSetting.findMany({ orderBy: [{ key: 'asc' }, { effectiveFrom: 'desc' }] }))).map(this.taxView);
    const current = new Map<string, string>();
    for (const r of rows) if (r.effectiveFrom! <= today && !current.has(r.key)) current.set(r.key, r.id);
    return rows.map((r) => ({ ...r, current: current.get(r.key) === r.id, upcoming: r.effectiveFrom! > today }));
  }

  /** A rate change is a new row from its effective date - earlier rows stay, so past documents keep the rate they used. */
  async addTaxSetting(dto: TaxSettingDto) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const effectiveFrom = date(dto.effectiveFrom)!;
      const clash = await tx.conTaxSetting.findUnique({ where: { organizationId_key_effectiveFrom: { organizationId, key: dto.key, effectiveFrom } } });
      if (clash) throw new BadRequestException(`There is already a ${dto.key} rate from ${dto.effectiveFrom}. Pick another date.`);
      const after = await tx.conTaxSetting.create({ data: { organizationId, key: dto.key, rate: dto.rate, threshold: dto.threshold ?? null, active: dto.active ?? true, effectiveFrom, notes: dto.notes?.trim() || null, createdBy: orgUserId } });
      await this.audit.logInTx(tx, { action: 'con_tax_setting.created', entityType: 'ConTaxSetting', entityId: after.id, after });
      return this.taxView(after);
    });
  }
}
