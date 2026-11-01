import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EtimsPurchaseStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { EtimsClient } from './etims.client';
import { EtimsSettingsService } from './etims-settings.service';
import {
  blankPayload,
  EtimsDocumentsService,
  StoredPayload,
  VARIANT_FOR_LINES,
} from './etims-documents.service';
import {
  compactDate,
  Invoice,
  invoiceNumberFrom,
  parseInvoices,
  PurchaseLine,
  purchaseLineFromInvoice,
} from './etims-purchase.util';
import {
  buildLines,
  KraLine,
  LineInfo,
  paymentCode,
  SaleDoesNotAddUp,
} from './etims-sales.util';
import {
  classifyResult,
  explainResult,
  INITIAL_LAST_REQ,
  kraTimestamp,
} from './etims.util';

const PAGE_SIZE = 50;

/**
 * Purchases. Two routes to the same confirmation at KRA:
 *  - a supplier who is on eTIMS has already told KRA about the sale to us; KRA lists it for us, we match its lines to our
 *    products and accept it (/selectTrnsPurchaseSalesList, then /insertTrnsPurchase);
 *  - a delivery from anyone else can be reported by hand from its goods-received note.
 * The goods themselves come in through receiving as before, and that stock movement is reported by the stock queue.
 */
@Injectable()
export class EtimsPurchasesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
    private readonly client: EtimsClient,
    private readonly settings: EtimsSettingsService,
    private readonly documents: EtimsDocumentsService,
  ) {}

  private async registrant(tx: TenantTx) {
    const { orgUserId } = getTenantStore();
    const ou = await tx.orgUser.findUnique({
      where: { id: orgUserId },
      include: { user: { select: { fullName: true } } },
    });
    return { id: orgUserId, name: ou?.user.fullName ?? 'Staff' };
  }

  /** Downloads the supplier invoices KRA holds for each connected branch, only what is new since the last time. */
  async sync() {
    const devices = await this.tenantPrisma.run((tx) =>
      tx.etimsDevice.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { bhfId: 'asc' },
      }),
    );
    if (devices.length === 0)
      throw new BadRequestException(
        'Turn eTIMS on and connect a branch to KRA first.',
      );
    const { organizationId } = getTenantStore();
    const result = { downloaded: 0, stopped: null as string | null };
    for (const d of devices) {
      const creds = await this.tenantPrisma.run((tx) =>
        this.settings.credentials(tx, d.branchId),
      );
      if (!creds) continue;
      const res = await this.client.call<{ saleList?: unknown[] }>(
        creds.environment,
        'selectTrnsPurchaseSalesList',
        {
          tin: creds.tin,
          bhfId: creds.bhfId,
          cmcKey: creds.cmcKey,
          lastReqDt: d.purchasesSyncedAt ?? INITIAL_LAST_REQ,
        },
      );
      const kind = classifyResult(res.resultCd);
      if (kind !== 'OK' && kind !== 'NO_DATA') {
        result.stopped = explainResult(res.resultCd, res.resultMsg);
        break;
      }
      const invoices = kind === 'OK' ? parseInvoices(res.data) : [];
      await this.tenantPrisma.run(async (tx) => {
        if (invoices.length) {
          const made = await tx.etimsPurchaseInvoice.createMany({
            data: invoices.map((i) => ({
              organizationId,
              branchId: d.branchId,
              spplrTin: i.spplrTin,
              spplrNm: i.spplrNm,
              spplrBhfId: i.spplrBhfId,
              spplrInvcNo: i.spplrInvcNo,
              rcptTyCd: i.rcptTyCd,
              pmtTyCd: i.pmtTyCd,
              salesDt: i.salesDt,
              totAmt: i.totAmt,
              body: i as unknown as Prisma.InputJsonValue,
            })),
            skipDuplicates: true,
          });
          result.downloaded += made.count;
        }
        if (/^\d{14}$/.test(res.resultDt))
          await tx.etimsDevice.update({
            where: { id: d.id },
            data: { purchasesSyncedAt: res.resultDt },
          });
      });
    }
    await this.tenantPrisma.run((tx) =>
      this.auditLog.logInTx(tx, {
        action: 'etims.purchases_synced',
        entityType: 'EtimsPurchaseInvoice',
        entityId: organizationId,
        after: result,
      }),
    );
    return result;
  }

  /** The supplier invoices, each line with the product we think it is (one matched before, or one with the same barcode). */
  async list(query: { status?: EtimsPurchaseStatus; page?: number }) {
    return this.tenantPrisma.run(async (tx) => {
      const grouped = await tx.etimsPurchaseInvoice.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      const counts: Record<EtimsPurchaseStatus, number> = {
        WAITING: 0,
        ACCEPTED: 0,
        DISMISSED: 0,
      };
      for (const g of grouped) counts[g.status] = g._count._all;
      const page = Math.max(1, query.page ?? 1);
      const where = query.status ? { status: query.status } : {};
      const [rows, total] = await Promise.all([
        tx.etimsPurchaseInvoice.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
        tx.etimsPurchaseInvoice.count({ where }),
      ]);
      const invoices = rows.map((r) => ({
        row: r,
        inv: r.body as unknown as Invoice,
      }));
      const tins = [...new Set(invoices.map((i) => i.row.spplrTin))];
      const codes = [
        ...new Set(invoices.flatMap((i) => i.inv.lines.map((l) => l.itemCd))),
      ];
      const barcodes = [
        ...new Set(
          invoices.flatMap((i) =>
            i.inv.lines.map((l) => l.bcd).filter((b): b is string => !!b),
          ),
        ),
      ];
      const [remembered, byBarcode, suppliers] = await Promise.all([
        tx.etimsSupplierItem.findMany({
          where: { spplrTin: { in: tins }, spplrItemCd: { in: codes } },
        }),
        barcodes.length
          ? tx.productVariant.findMany({
              where: { barcode: { in: barcodes } },
              select: { id: true, barcode: true },
            })
          : Promise.resolve([]),
        tx.supplier.findMany({
          where: { kraPin: { in: tins } },
          select: { id: true, name: true, kraPin: true },
        }),
      ]);
      const mapped = new Map(
        remembered.map((m) => [`${m.spplrTin}|${m.spplrItemCd}`, m.variantId]),
      );
      const bcMap = new Map(byBarcode.map((v) => [v.barcode!, v.id]));
      const ids = new Set<string>();
      const suggestion = (tin: string, l: Invoice['lines'][number]) => {
        const id =
          mapped.get(`${tin}|${l.itemCd}`) ??
          (l.bcd ? bcMap.get(l.bcd) : undefined);
        if (id) ids.add(id);
        return id ?? null;
      };
      const withSuggestions = invoices.map((i) => ({
        ...i,
        suggested: i.inv.lines.map((l) => suggestion(i.row.spplrTin, l)),
      }));
      const variants = ids.size
        ? await tx.productVariant.findMany({
            where: { id: { in: [...ids] } },
            include: { product: true, etimsItem: true },
          })
        : [];
      const vById = new Map(variants.map((v) => [v.id, v]));
      const supplierBy = new Map(suppliers.map((s) => [s.kraPin, s.name]));
      return {
        counts,
        total,
        page,
        pageSize: PAGE_SIZE,
        rows: withSuggestions.map(({ row, inv, suggested }) => ({
          id: row.id,
          status: row.status,
          supplierPin: row.spplrTin,
          supplierName: row.spplrNm,
          knownSupplier: supplierBy.get(row.spplrTin) ?? null,
          invoiceNo: row.spplrInvcNo,
          kind:
            row.rcptTyCd === 'R'
              ? ('CREDIT_NOTE' as const)
              : ('INVOICE' as const),
          date: row.salesDt,
          total: Number(row.totAmt),
          goodsReceiptId: row.goodsReceiptId,
          lines: inv.lines.map((l, n) => {
            const v = suggested[n] ? vById.get(suggested[n]!) : undefined;
            return {
              itemSeq: l.itemSeq,
              itemCd: l.itemCd,
              name: l.itemNm,
              qty: l.qty,
              price: l.prc,
              total: l.totAmt,
              suggested: v
                ? {
                    variantId: v.id,
                    name: v.name
                      ? `${v.product.name} - ${v.name}`
                      : v.product.name,
                    sku: v.sku,
                    registered: v.etimsItem?.status === 'REGISTERED',
                  }
                : null,
            };
          }),
        })),
      };
    });
  }

  /**
   * Accepts a supplier invoice: every line is matched to one of our products (which must be registered with KRA), the match is
   * remembered for next time, and a purchase confirmation is queued to be sent.
   */
  async accept(
    id: string,
    dto: {
      lines: { itemSeq: number; variantId: string }[];
      goodsReceiptId?: string;
    },
  ) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const row = await tx.etimsPurchaseInvoice.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Invoice not found');
      if (row.status !== 'WAITING')
        throw new BadRequestException('That invoice was already dealt with.');
      if (row.rcptTyCd === 'R')
        throw new BadRequestException(
          "This is the supplier's credit note. Confirm it on the KRA portal; here it can only be put aside.",
        );
      const inv = row.body as unknown as Invoice;
      const wanted = new Map(dto.lines.map((l) => [l.itemSeq, l.variantId]));
      const missing = inv.lines.filter((l) => !wanted.has(l.itemSeq));
      if (missing.length)
        throw new BadRequestException(
          `Choose our product for: ${missing
            .slice(0, 5)
            .map((l) => l.itemNm)
            .join(', ')}`,
        );
      if (dto.goodsReceiptId) {
        const g = await tx.goodsReceipt.findUnique({
          where: { id: dto.goodsReceiptId },
          select: { id: true },
        });
        if (!g) throw new NotFoundException('Goods-received note not found');
      }
      const ids = [...new Set(inv.lines.map((l) => wanted.get(l.itemSeq)!))];
      const variants = await tx.productVariant.findMany({
        where: { id: { in: ids } },
        include: VARIANT_FOR_LINES,
      });
      if (variants.length !== ids.length)
        throw new NotFoundException('One of those products was not found');
      const creds = await this.settings.credentials(tx, row.branchId);
      if (!creds)
        throw new BadRequestException(
          'The branch this invoice came to is no longer connected to KRA.',
        );
      const { infos } = await this.documents.lineInfos(
        tx,
        creds.environment,
        variants,
      );
      const unregistered = variants.filter((v) => !infos.get(v.id));
      if (unregistered.length)
        throw new BadRequestException(
          `Register these with KRA first (Products and KRA): ${unregistered
            .slice(0, 5)
            .map((v) => v.product.name)
            .join(', ')}`,
        );
      const lines: PurchaseLine[] = inv.lines.map((l, i) => {
        const variantId = wanted.get(l.itemSeq)!;
        const info = infos.get(variantId) as LineInfo;
        return purchaseLineFromInvoice(l, { variantId, ...info }, i + 1);
      });
      const purchaseDate =
        compactDate(inv.salesDt)?.slice(0, 8) ??
        kraTimestamp(new Date()).slice(0, 8);
      const now = new Date();
      const payload: StoredPayload = {
        ...blankPayload(now, await this.registrant(tx)),
        lines,
        rates: inv.rates,
        pmtTyCd: inv.pmtTyCd ?? '01',
        purchase: {
          regTyCd: 'A',
          purchaseDate,
          supplier: {
            tin: row.spplrTin,
            bhfId: row.spplrBhfId,
            name: row.spplrNm,
            invcNo: row.spplrInvcNo,
          },
        },
      };
      const doc = await tx.etimsDocument.create({
        data: {
          organizationId,
          branchId: row.branchId,
          kind: 'PURCHASE',
          sourceKey: `PURCHASE:${row.id}`,
          purchaseInvoiceId: row.id,
          receiptId: dto.goodsReceiptId ?? null,
          // nothing to send after the confirmation: the stock comes in with the delivery
          stockDone: true,
          masterDone: true,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
      for (const v of variants) {
        const line = inv.lines.find((l) => wanted.get(l.itemSeq) === v.id)!;
        await tx.etimsSupplierItem.upsert({
          where: {
            organizationId_spplrTin_spplrItemCd: {
              organizationId,
              spplrTin: row.spplrTin,
              spplrItemCd: line.itemCd,
            },
          },
          create: {
            organizationId,
            spplrTin: row.spplrTin,
            spplrItemCd: line.itemCd,
            variantId: v.id,
          },
          update: { variantId: v.id },
        });
      }
      await tx.etimsPurchaseInvoice.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          decidedAt: now,
          goodsReceiptId: dto.goodsReceiptId ?? null,
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'etims.purchase_accepted',
        entityType: 'EtimsPurchaseInvoice',
        entityId: id,
        after: {
          supplier: row.spplrTin,
          invoiceNo: row.spplrInvcNo,
          total: Number(row.totAmt),
          documentId: doc.id,
        },
      });
      return { documentId: doc.id };
    });
  }

  /** Puts an invoice aside without telling KRA anything (a supplier credit note, or an invoice that is not ours). */
  async dismiss(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const row = await tx.etimsPurchaseInvoice.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Invoice not found');
      if (row.status !== 'WAITING')
        throw new BadRequestException('That invoice was already dealt with.');
      await tx.etimsPurchaseInvoice.update({
        where: { id },
        data: { status: 'DISMISSED', decidedAt: new Date() },
      });
      await this.auditLog.logInTx(tx, {
        action: 'etims.purchase_dismissed',
        entityType: 'EtimsPurchaseInvoice',
        entityId: id,
      });
      return { ok: true };
    });
  }

  /** Deliveries received since sending was switched on, and whether each has been reported to KRA as a purchase by hand. */
  async receipts() {
    return this.tenantPrisma.run(async (tx) => {
      const setting = await tx.etimsSetting.findFirst();
      if (!setting?.salesStartAt) return [];
      const rows = await tx.goodsReceipt.findMany({
        where: {
          createdAt: { gte: setting.salesStartAt },
          supplierId: { not: null },
        },
        include: {
          supplier: true,
          lines: true,
          bills: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const docs = await tx.etimsDocument.findMany({
        where: {
          kind: 'PURCHASE',
          receiptId: { in: rows.map((r) => r.id) },
        },
        select: { receiptId: true, status: true },
      });
      const reported = new Map(docs.map((d) => [d.receiptId, d.status]));
      return rows.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        createdAt: r.createdAt,
        supplierName: r.supplier?.name ?? null,
        supplierPin: r.supplier?.kraPin ?? null,
        deliveryNote: r.deliveryNote,
        lines: r.lines.filter((l) => Number(l.quantityAccepted) > 0).length,
        value: r.lines.reduce(
          (s, l) =>
            s +
            Number(l.quantityAccepted) * (l.unitCost ? Number(l.unitCost) : 0),
          0,
        ),
        missingPrices: r.lines.filter(
          (l) => Number(l.quantityAccepted) > 0 && !l.unitCost,
        ).length,
        reported: reported.get(r.id) ?? null,
      }));
    });
  }

  /**
   * Reports a delivery to KRA as a purchase entered by hand, for a supplier who is not on eTIMS (or sent no invoice). Prices are
   * the unit costs on the delivery, treated as before tax like every price here, with the product's tax added on top.
   */
  async reportReceipt(receiptId: string) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const g = await tx.goodsReceipt.findUnique({
        where: { id: receiptId },
        include: {
          supplier: true,
          lines: true,
          bills: { select: { id: true } },
        },
      });
      if (!g) throw new NotFoundException('Goods-received note not found');
      const setting = await tx.etimsSetting.findFirst();
      if (!setting?.salesStartAt || g.createdAt < setting.salesStartAt)
        throw new BadRequestException(
          'Only deliveries received after sending to KRA was switched on can be reported.',
        );
      if (!g.supplier?.kraPin)
        throw new BadRequestException(
          "Add the supplier's KRA PIN on the Suppliers screen first.",
        );
      if (
        await tx.etimsDocument.findFirst({
          where: { kind: 'PURCHASE', receiptId },
        })
      )
        throw new BadRequestException('That delivery was already reported.');
      const lines = g.lines.filter((l) => Number(l.quantityAccepted) > 0);
      if (lines.length === 0)
        throw new BadRequestException('Nothing was accepted on that delivery.');
      const noPrice = lines.filter(
        (l) => !l.unitCost || Number(l.unitCost) <= 0,
      );
      const variants = await tx.productVariant.findMany({
        where: { id: { in: lines.map((l) => l.variantId) } },
        include: VARIANT_FOR_LINES,
      });
      const byId = new Map(variants.map((v) => [v.id, v]));
      if (noPrice.length)
        throw new BadRequestException(
          `These have no price on the delivery: ${noPrice
            .slice(0, 5)
            .map((l) => byId.get(l.variantId)?.product.name ?? l.variantId)
            .join(', ')}`,
        );
      const creds = await this.settings.credentials(tx, g.branchId);
      if (!creds)
        throw new BadRequestException(
          'The branch that received this delivery is not connected to KRA.',
        );
      const { infos, rates } = await this.documents.lineInfos(
        tx,
        creds.environment,
        variants,
      );
      const unregistered = variants.filter((v) => !infos.get(v.id));
      if (unregistered.length)
        throw new BadRequestException(
          `Register these with KRA first (Products and KRA): ${unregistered
            .slice(0, 5)
            .map((v) => v.product.name)
            .join(', ')}`,
        );
      const input = lines.map((l) => {
        const v = byId.get(l.variantId)!;
        const qty = Number(l.quantityAccepted);
        const cost = Number(l.unitCost);
        const rate =
          v.product.taxClass && !v.product.taxClass.isExempt
            ? Number(v.product.taxClass.rate)
            : 0;
        return {
          variantId: l.variantId,
          quantity: qty,
          unitPrice: cost,
          taxAmount: Math.round(cost * qty * rate * 100) / 100,
        };
      });
      const total =
        input.reduce(
          (s, l) =>
            s +
            Math.round(l.unitPrice * l.quantity * 100) +
            Math.round(l.taxAmount * 100),
          0,
        ) / 100;
      let kra: KraLine[];
      try {
        kra = buildLines(
          input,
          input.map((l) => infos.get(l.variantId) as LineInfo),
          total,
        );
      } catch (e) {
        if (e instanceof SaleDoesNotAddUp)
          throw new BadRequestException(e.message);
        throw e;
      }
      const purchaseLines: PurchaseLine[] = kra.map((l) => ({
        ...l,
        spplrItemCd: null,
        spplrItemClsCd: null,
        spplrItemNm: null,
      }));
      const now = new Date();
      const payload: StoredPayload = {
        ...blankPayload(now, await this.registrant(tx)),
        lines: purchaseLines,
        rates,
        pmtTyCd: g.bills.length ? '02' : paymentCode([]),
        purchase: {
          regTyCd: 'M',
          purchaseDate: kraTimestamp(g.createdAt).slice(0, 8),
          supplier: {
            tin: g.supplier.kraPin,
            bhfId: '00',
            name: g.supplier.name,
            invcNo: invoiceNumberFrom(g.deliveryNote),
          },
        },
      };
      const doc = await tx.etimsDocument.create({
        data: {
          organizationId,
          branchId: g.branchId,
          kind: 'PURCHASE',
          sourceKey: `PURCHASE:R:${g.id}`,
          receiptId: g.id,
          stockDone: true,
          masterDone: true,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'etims.purchase_reported',
        entityType: 'GoodsReceipt',
        entityId: g.id,
        after: { supplier: g.supplier.name, total, documentId: doc.id },
      });
      return { documentId: doc.id };
    });
  }
}
