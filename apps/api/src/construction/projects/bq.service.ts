import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../../common/tenant/tenant-context';
import { Tx } from '../common/con-access';
import { BqItemDto, BqSectionDto } from '../dto/projects.dto';
import { BqParse, Cell, parseBq, parseCsv } from './projects.util';

export const MAX_BQ_BYTES = 5 * 1024 * 1024;
const LOCKED = ['DLP', 'CLOSED'];
const round2 = (n: number) => Math.round(n * 100) / 100;

function cellValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
  if (o.richText) return o.richText.map((t) => t.text).join('');
  if ('result' in o) return cellValue(o.result);
  if (typeof o.text === 'string') return o.text;
  return null;
}

/** Reads an uploaded .xlsx or .csv into rows, one list per sheet. */
export async function readSheets(contentType: string, fileName: string | undefined, body: Buffer): Promise<{ name: string; rows: Cell[][] }[]> {
  const isCsv = contentType.includes('csv') || /\.csv$/i.test(fileName ?? '');
  if (isCsv) return [{ name: 'BQ', rows: parseCsv(body.toString('utf8').replace(/^﻿/, '')) }];
  if (body.subarray(0, 2).toString('ascii') !== 'PK') throw new BadRequestException('Upload the BQ as an Excel .xlsx file or a .csv file (old .xls files: save as .xlsx first).');
  const wb = new Workbook();
  try {
    await wb.xlsx.load(body as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('That Excel file could not be read. Save it again as .xlsx and retry.');
  }
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values = row.values as unknown[];
      rows[n - 1] = values.slice(1).map(cellValue);
    });
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
  });
}

/** The Bill of Quantities: import with a preview (nothing saved until confirmed), manual edits, and totals against the contract sum. */
@Injectable()
export class BqService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private async project(tx: Tx, projectId: string, forWrite = false) {
    const p = await tx.conProject.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException('Project not found');
    if (forWrite && LOCKED.includes(p.status)) throw new ConflictException(`The BQ of a project in ${p.status} cannot be changed.`);
    return p;
  }

  async get(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId);
      const sections = await tx.conBqSection.findMany({ where: { projectId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { items: { orderBy: { sortOrder: 'asc' } } } });
      const view = sections.map((s) => {
        const items = s.items.map((i) => ({ id: i.id, code: i.code, description: i.description, unit: i.unit, qty: Number(i.qty), rate: Number(i.rate), amount: Number(i.amount) }));
        return { id: s.id, code: s.code, name: s.name, items, total: round2(items.reduce((a, i) => a + i.amount, 0)) };
      });
      const total = round2(view.reduce((a, s) => a + s.total, 0));
      const contractSum = Number(p.contractSum);
      return { projectId, contractSum, total, difference: round2(total - contractSum), locked: LOCKED.includes(p.status), sections: view };
    });
  }

  /** Reads the file and reports what would be saved. Saves (replacing the whole BQ) only when `save` is set and nothing is wrong. */
  async import(projectId: string, contentType: string, fileName: string | undefined, body: Buffer, save: boolean) {
    if (!body.length) throw new BadRequestException('The file is empty');
    const parsed: BqParse = parseBq(await readSheets(contentType, fileName, body));
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId, save);
      const contractSum = Number(p.contractSum);
      const summary = {
        sections: parsed.sections.map((s) => ({ code: s.code, name: s.name, items: s.items.length, total: round2(s.items.reduce((a, i) => a + i.amount, 0)), preview: s.items.slice(0, 5) })),
        itemCount: parsed.itemCount,
        total: parsed.total,
        contractSum,
        difference: round2(parsed.total - contractSum),
        errors: parsed.errors,
        warnings: parsed.warnings,
        saved: false,
      };
      if (!save) return summary;
      if (parsed.errors.length) throw new BadRequestException({ statusCode: 400, message: 'Fix the errors in the file first.', ...summary });
      const before = await tx.conBqItem.aggregate({ where: { projectId }, _sum: { amount: true }, _count: true });
      await tx.conBqSection.deleteMany({ where: { projectId } });
      for (const [si, s] of parsed.sections.entries()) {
        const section = await tx.conBqSection.create({ data: { organizationId, projectId, code: s.code, name: s.name, sortOrder: si } });
        await tx.conBqItem.createMany({
          data: s.items.map((i, ii) => ({ organizationId, projectId, sectionId: section.id, code: i.code, description: i.description, unit: i.unit, qty: i.qty, rate: i.rate, amount: i.amount, sortOrder: ii })),
        });
      }
      await this.audit.logInTx(tx, {
        action: 'con_bq.imported',
        entityType: 'ConProject',
        entityId: projectId,
        before: { items: before._count, total: Number(before._sum.amount ?? 0) },
        after: { items: parsed.itemCount, sections: parsed.sections.length, total: parsed.total, fileName: fileName ?? null },
      });
      return { ...summary, saved: true };
    });
  }

  async saveSection(projectId: string, dto: BqSectionDto, id?: string) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId, true);
      if (!id) {
        const sortOrder = await tx.conBqSection.count({ where: { projectId } });
        const after = await tx.conBqSection.create({ data: { organizationId, projectId, code: dto.code?.trim() || null, name: dto.name.trim(), sortOrder } });
        await this.audit.logInTx(tx, { action: 'con_bq_section.created', entityType: 'ConBqSection', entityId: after.id, after });
        return after;
      }
      const before = await tx.conBqSection.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Section not found');
      const after = await tx.conBqSection.update({ where: { id }, data: { code: dto.code?.trim() || null, name: dto.name.trim() } });
      await this.audit.logInTx(tx, { action: 'con_bq_section.updated', entityType: 'ConBqSection', entityId: id, before, after });
      return after;
    });
  }

  async removeSection(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId, true);
      const before = await tx.conBqSection.findFirst({ where: { id, projectId }, include: { items: true } });
      if (!before) throw new NotFoundException('Section not found');
      await tx.conBqSection.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_bq_section.deleted', entityType: 'ConBqSection', entityId: id, before });
      return { ok: true };
    });
  }

  async saveItem(projectId: string, dto: BqItemDto, id?: string) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId, true);
      if (!(await tx.conBqSection.findFirst({ where: { id: dto.sectionId, projectId } }))) throw new NotFoundException('Section not found');
      const data = { sectionId: dto.sectionId, code: dto.code?.trim() || null, description: dto.description.trim(), unit: dto.unit.trim(), qty: dto.qty, rate: dto.rate, amount: round2(dto.qty * dto.rate) };
      if (!id) {
        const sortOrder = await tx.conBqItem.count({ where: { sectionId: dto.sectionId } });
        const after = await tx.conBqItem.create({ data: { organizationId, projectId, sortOrder, ...data } });
        await this.audit.logInTx(tx, { action: 'con_bq_item.created', entityType: 'ConBqItem', entityId: after.id, after });
        return after;
      }
      const before = await tx.conBqItem.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Item not found');
      const after = await tx.conBqItem.update({ where: { id }, data });
      await this.audit.logInTx(tx, { action: 'con_bq_item.updated', entityType: 'ConBqItem', entityId: id, before, after });
      return after;
    });
  }

  async removeItem(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId, true);
      const before = await tx.conBqItem.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Item not found');
      await tx.conBqItem.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_bq_item.deleted', entityType: 'ConBqItem', entityId: id, before });
      return { ok: true };
    });
  }
}
