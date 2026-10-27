import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { variantTitle } from '../catalog/variant-title';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { pluRows, ReportDoc, summarise } from './etims-reports.util';

type Tx = Prisma.TransactionClient;
type Doc = Prisma.EtimsDocumentGetPayload<object>;

const nairobiStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
const nextDay = (day: string) => new Date(nairobiStart(day).getTime() + 86_400_000);
const dayOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(nairobiStart(d).getTime());

/** What the stored payload of a document gives a report. */
function toReportDoc(d: Doc): ReportDoc | null {
  const p = d.payload as unknown as {
    lines?: ReportDoc['lines'];
    rates?: ReportDoc['rates'];
    pmtTyCd?: string;
  } | null;
  if (!p?.lines) return null;
  return {
    kind: d.kind === 'SALE' ? 'SALE' : 'CREDIT',
    lines: p.lines,
    rates: p.rates ?? {},
    pmtTyCd: p.pmtTyCd ?? '01',
  };
}

/**
 * The reports KRA's trader-system specification asks for: X (everything KRA has signed on a branch since the last Z), Z (the same,
 * closed and kept as the day's accounting record: each document is in exactly one Z), PLU (every item sold between two dates with
 * the stock left) and closing stock on a date. Built from what was sent to KRA and signed, so the figures match KRA's.
 */
@Injectable()
export class EtimsReportsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  private async openDocs(tx: Tx, branchId: string) {
    return tx.etimsDocument.findMany({
      where: { branchId, saleDone: true, rcptSign: { not: null }, zReportId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async figures(tx: Tx, branchId: string, docs: Doc[], since: Date | null) {
    const reportDocs = docs.map(toReportDoc).filter((d): d is ReportDoc => d !== null);
    const after = since ? { gt: since } : undefined;
    const [prints, shifts, incomplete, manual] = await Promise.all([
      tx.etimsReceiptPrint.findMany({ where: { branchId, createdAt: after } }),
      tx.shift.findMany({ where: { branchId, openedAt: after }, select: { openingFloat: true } }),
      tx.etimsDocument.count({ where: { branchId, saleDone: false, status: { in: ['PENDING', 'REJECTED'] } } }),
      tx.etimsDocument.count({ where: { branchId, status: 'MANUAL', kind: 'CREDIT_NOTE', createdAt: after } }),
    ]);
    const copyDocs = prints.length
      ? await tx.etimsDocument.findMany({
          where: { saleId: { in: [...new Set(prints.map((p) => p.saleId))] } },
          select: { saleId: true, kind: true, payload: true },
        })
      : [];
    const amountOf = (saleId: string, kind: string) => {
      const d = copyDocs.find((x) => x.saleId === saleId && (kind === 'CREDIT' ? x.kind === 'CREDIT_NOTE' : x.kind === 'SALE'));
      const lines = (d?.payload as unknown as { lines?: { totAmt: number }[] } | null)?.lines ?? [];
      return lines.reduce((s, l) => s + Math.round(l.totAmt * 100), 0) / 100;
    };
    const copies = { sale: { count: 0, amount: 0 }, credit: { count: 0, amount: 0 } };
    for (const p of prints) {
      const side = p.kind === 'CREDIT' ? copies.credit : copies.sale;
      side.count += 1;
      side.amount = Math.round((side.amount + amountOf(p.saleId, p.kind)) * 100) / 100;
    }
    return summarise(reportDocs, {
      copies,
      openingDeposit: shifts.reduce((s, x) => s + Number(x.openingFloat), 0),
      incomplete,
      manualCreditNotes: manual,
    });
  }

  private async branchInfo(tx: Tx, branchId: string) {
    const { organizationId } = getTenantStore();
    const [branch, org, setting] = await Promise.all([
      tx.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } }),
      tx.organization.findUnique({ where: { id: organizationId }, select: { name: true, kraPin: true } }),
      tx.etimsSetting.findFirst(),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    return {
      branch,
      business: { name: org?.name ?? '', pin: setting?.tin ?? org?.kraPin ?? null },
    };
  }

  /** The X report: what KRA has signed on the branch since the last Z. Nothing is changed by looking at it. */
  async x(branchId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const info = await this.branchInfo(tx, branchId);
      const last = await tx.etimsZReport.findFirst({ where: { branchId }, orderBy: { number: 'desc' } });
      const docs = await this.openDocs(tx, branchId);
      return {
        type: 'X',
        ...info,
        generatedAt: new Date(),
        sinceLastZ: last ? { number: last.number, at: last.toAt } : null,
        documents: docs.length,
        totals: await this.figures(tx, branchId, docs, last?.toAt ?? null),
      };
    });
  }

  /** The Z report: closes the period. Every document in it is marked as reported, so the next X and Z start afresh. */
  async z(branchId: string) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const info = await this.branchInfo(tx, branchId);
      const docs = await this.openDocs(tx, branchId);
      if (docs.length === 0)
        throw new ConflictException('Nothing has been signed by KRA since the last Z report, so there is nothing to close.');
      const last = await tx.etimsZReport.findFirst({ where: { branchId }, orderBy: { number: 'desc' } });
      const now = new Date();
      const totals = await this.figures(tx, branchId, docs, last?.toAt ?? null);
      const me = await tx.orgUser.findUnique({
        where: { id: orgUserId },
        select: { user: { select: { fullName: true } } },
      });
      const row = await tx.etimsZReport.create({
        data: {
          organizationId,
          branchId,
          number: (last?.number ?? 0) + 1,
          fromAt: last?.toAt ?? docs[0].createdAt,
          toAt: now,
          totals: { ...totals, documents: docs.length } as unknown as Prisma.InputJsonValue,
          createdByName: me?.user.fullName ?? null,
        },
      });
      await tx.etimsDocument.updateMany({
        where: { id: { in: docs.map((d) => d.id) } },
        data: { zReportId: row.id },
      });
      return this.zView(row, info);
    });
  }

  private zView(
    r: Prisma.EtimsZReportGetPayload<object>,
    info: { branch: { id: string; name: string }; business: { name: string; pin: string | null } },
  ) {
    return {
      type: 'Z',
      id: r.id,
      number: r.number,
      ...info,
      fromAt: r.fromAt,
      toAt: r.toAt,
      generatedAt: r.createdAt,
      createdByName: r.createdByName,
      totals: r.totals,
    };
  }

  async listZ(branchId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.etimsZReport.findMany({
        where: { branchId },
        orderBy: { number: 'desc' },
        take: 100,
      });
      return rows.map((r) => {
        const t = r.totals as unknown as { sales?: { count: number; total: number }; creditNotes?: { count: number; total: number } };
        return {
          id: r.id,
          number: r.number,
          fromAt: r.fromAt,
          toAt: r.toAt,
          createdByName: r.createdByName,
          sales: t.sales ?? { count: 0, total: 0 },
          creditNotes: t.creditNotes ?? { count: 0, total: 0 },
        };
      });
    });
  }

  async getZ(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const r = await tx.etimsZReport.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Z report not found');
      return this.zView(r, await this.branchInfo(tx, r.branchId));
    });
  }

  /** The PLU report: each item sold between two dates, how many and for how much, and what is left in stock now. */
  async plu(branchId: string, from: string, to: string) {
    if (!dayOk(from) || !dayOk(to) || to < from)
      throw new BadRequestException('Choose a start date and an end date that is not before it.');
    return this.tenantPrisma.run(async (tx) => {
      const info = await this.branchInfo(tx, branchId);
      const docs = await tx.etimsDocument.findMany({
        where: {
          branchId,
          saleDone: true,
          rcptSign: { not: null },
          createdAt: { gte: nairobiStart(from), lt: nextDay(to) },
        },
      });
      const reportDocs = docs.map(toReportDoc).filter((d): d is ReportDoc => d !== null);
      const variantIds = [
        ...new Set(reportDocs.flatMap((d) => d.lines.map((l) => l.variantId).filter((v): v is string => Boolean(v)))),
      ];
      const stock = new Map<string, number>();
      if (variantIds.length) {
        const g = await tx.inventoryTransaction.groupBy({
          by: ['variantId'],
          where: { branchId, variantId: { in: variantIds } },
          _sum: { quantityDelta: true },
        });
        for (const r of g) stock.set(r.variantId, Number(r._sum.quantityDelta ?? 0));
      }
      const rows = pluRows(reportDocs, stock);
      return {
        type: 'PLU',
        ...info,
        from,
        to,
        generatedAt: new Date(),
        rows,
        totals: {
          quantity: Math.round(rows.reduce((s, r) => s + r.quantity, 0) * 1000) / 1000,
          amount: Math.round(rows.reduce((s, r) => s + r.amount * 100, 0)) / 100,
        },
      };
    });
  }

  /** Stock on hand at the end of a day, from the stock movements up to then. */
  async closingStock(branchId: string, date: string) {
    if (!dayOk(date)) throw new BadRequestException('Choose a date.');
    return this.tenantPrisma.run(async (tx) => {
      const info = await this.branchInfo(tx, branchId);
      const g = await tx.inventoryTransaction.groupBy({
        by: ['variantId'],
        where: { branchId, createdAt: { lt: nextDay(date) } },
        _sum: { quantityDelta: true },
      });
      const nonZero = g.filter((r) => Number(r._sum.quantityDelta ?? 0) !== 0);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: nonZero.map((r) => r.variantId) } },
        select: { id: true, sku: true, name: true, product: { select: { name: true } } },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));
      const rows = nonZero
        .map((r) => {
          const v = byId.get(r.variantId);
          return {
            variantId: r.variantId,
            sku: v?.sku ?? '',
            name: v ? variantTitle(v.product.name, v.name) : r.variantId,
            quantity: Number(r._sum.quantityDelta ?? 0),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return { type: 'CLOSING_STOCK', ...info, date, generatedAt: new Date(), rows };
    });
  }
}
