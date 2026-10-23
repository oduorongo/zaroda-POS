import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EtimsDocStatus, EtimsEnvironment, Prisma } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { EtimsClient } from './etims.client';
import { EtimsSettingsService } from './etims-settings.service';
import {
  backoffMinutes,
  buildLines,
  buildSalesBody,
  buildStockIoBody,
  buildStockMasterBody,
  KraLine,
  LineInfo,
  paymentCode,
  Registrant,
  SaleDoesNotAddUp,
  taxTotals,
  tracksStock,
  unsendableReason,
  TaxLetter,
} from './etims-sales.util';
import {
  buildPurchaseBody,
  groupMoves,
  PurchaseLine,
} from './etims-purchase.util';
import { itemName, mapTaxType } from './etims-items.util';
import { classifyResult, explainResult } from './etims.util';

const PAGE_SIZE = 50;
/** How many new sales or refunds are picked up, and how many documents are sent, in one pass. */
const ENQUEUE_BATCH = 200;
const SEND_BATCH = 50;
/** A document being sent is claimed for this long so a second pass does not send it twice. */
const LEASE_MS = 2 * 60_000;
/** Waiting for a product to be registered with KRA is not a failure: look again after this long. */
const WAIT_FOR_ITEMS_MIN = 10;
/** KRA's refund reason code for a plain refund (spec 4.17). */
const REFUND_REASON = '06';
/** A change to stock is only reported once it is this old, so a multi-line operation is always whole when it is read. */
// (ETIMS_MOVE_SETTLE_MS exists so the end-to-end test need not wait a minute)
const SETTLE_MS = Number(process.env.ETIMS_MOVE_SETTLE_MS ?? 60_000);
const MOVE_SCAN_ROWS = 2000;
/** Stock changes that are reported by this route. Sales have their own document, and the rest are not reported yet. */
const MOVE_TYPES = [
  'ADJUSTMENT',
  'STOCKTAKE',
  'WASTE',
  'TRANSFER',
  'REPACK',
  'PRODUCTION',
  'RECEIPT',
] as const;
const SYSTEM_REGISTRANT: Registrant = { id: 'system', name: 'Zaroda POS' };

/** What is kept of a document so every retry sends exactly the same thing. */
export interface StoredPayload {
  at: string;
  creditAt: string | null;
  lines: KraLine[];
  pmtTyCd: string;
  customerName: string | null;
  customerPhone: string | null;
  rates: Partial<Record<TaxLetter, number>>;
  business: { name: string; address: string | null };
  registrant: Registrant;
  orgInvcNo: number;
  /** A stock movement: its KRA type, and (until it is worked out) the raw rows it was made from. */
  sarTyCd?: string;
  moveRows?: { variantId: string; quantity: number }[];
  /** A purchase: who from, and how it was registered. */
  purchase?: {
    regTyCd: 'A' | 'M';
    purchaseDate: string;
    supplier: {
      tin: string | null;
      bhfId: string | null;
      name: string | null;
      invcNo: number | null;
    };
  };
}

export const blankPayload = (
  at: Date,
  registrant: Registrant = SYSTEM_REGISTRANT,
): StoredPayload => ({
  at: at.toISOString(),
  creditAt: null,
  lines: [],
  pmtTyCd: '01',
  customerName: null,
  customerPhone: null,
  rates: {},
  business: { name: '', address: null },
  registrant,
  orgInvcNo: 0,
});

export interface PassResult {
  queued: number;
  sent: number;
  rejected: number;
  waiting: number;
  stopped: string | null;
}

export const VARIANT_FOR_LINES = {
  product: { include: { taxClass: true } },
  etimsItem: true,
} satisfies Prisma.ProductVariantInclude;
type VariantForLines = Prisma.ProductVariantGetPayload<{
  include: typeof VARIANT_FOR_LINES;
}>;

/**
 * What goes to KRA, as a queue. Each finished sale (and each full refund), each purchase confirmed, and each stock movement that is
 * not a sale becomes one document; a pass picks up new ones and sends the due ones. A document goes through its steps in KRA's
 * required order - for a sale the sale, then the stock movement, then the stock level of each item - and remembers each step, so a
 * retry carries on where it stopped and nothing is ever sent twice. The numbers KRA is sent are made once and kept. Nothing here
 * ever blocks or fails a sale.
 */
@Injectable()
export class EtimsDocumentsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly client: EtimsClient,
    private readonly settings: EtimsSettingsService,
  ) {}

  /**
   * Picks up what happened since sending was switched on and has no document yet: sales, full refunds and stock movements. Sales
   * and refunds are found by asking the database which have no document; stock movements by a cursor, because their document keys
   * are worked out from several rows.
   */
  async enqueue(now: Date = new Date()): Promise<number> {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const setting = await tx.etimsSetting.findFirst();
      if (!setting?.enabled || !setting.sendSales || !setting.salesStartAt)
        return 0;
      const start = setting.salesStartAt;
      // the columns hold UTC times without a zone, so the cut-off is given the same way (a Date would be shifted by the server's zone)
      const startText = start.toISOString();
      const devices = await tx.etimsDevice.findMany({
        where: { status: 'ACTIVE' },
        select: { branchId: true },
      });
      const branchIds = devices.map((d) => d.branchId);
      if (branchIds.length === 0) return 0;
      let queued = 0;

      const sales = await tx.$queryRaw<{ id: string; branchId: string }[]>`
        SELECT s.id, s."branchId" FROM sales s
        WHERE s.status = 'COMPLETED' AND s."branchId" = ANY(${branchIds}::text[]) AND s."createdAt" >= ${startText}::timestamp
          AND NOT EXISTS (SELECT 1 FROM etims_documents d WHERE d."organizationId" = s."organizationId" AND d."sourceKey" = 'SALE:' || s.id)
        ORDER BY s."createdAt" ASC LIMIT ${ENQUEUE_BATCH}`;
      if (sales.length) {
        const r = await tx.etimsDocument.createMany({
          data: sales.map((s) => ({
            organizationId,
            branchId: s.branchId,
            kind: 'SALE' as const,
            saleId: s.id,
            sourceKey: `SALE:${s.id}`,
          })),
          skipDuplicates: true,
        });
        queued += r.count;
      }

      // a refund of a sale that KRA has (or is about to have) becomes a credit note
      const refunds = await tx.$queryRaw<
        { id: string; saleId: string; branchId: string }[]
      >`
        SELECT r.id, r."saleId", s."branchId" FROM refunds r JOIN sales s ON s.id = r."saleId"
        WHERE s."branchId" = ANY(${branchIds}::text[]) AND r."createdAt" >= ${startText}::timestamp
          AND NOT EXISTS (SELECT 1 FROM etims_documents d WHERE d."organizationId" = s."organizationId" AND d."sourceKey" = 'CREDIT:' || r.id)
          AND EXISTS (SELECT 1 FROM etims_documents d WHERE d."organizationId" = s."organizationId" AND d."sourceKey" = 'SALE:' || r."saleId")
        ORDER BY r."createdAt" ASC LIMIT ${ENQUEUE_BATCH}`;
      if (refunds.length) {
        const r = await tx.etimsDocument.createMany({
          data: refunds.map((x) => ({
            organizationId,
            branchId: x.branchId,
            kind: 'CREDIT_NOTE' as const,
            saleId: x.saleId,
            refundId: x.id,
            sourceKey: `CREDIT:${x.id}`,
          })),
          skipDuplicates: true,
        });
        queued += r.count;
      }

      queued += await this.enqueueMoves(
        tx,
        organizationId,
        setting.stockScannedAt && setting.stockScannedAt > start
          ? setting.stockScannedAt
          : start,
        branchIds,
        now,
      );
      return queued;
    });
  }

  /** Stock movements other than sales: read from the stock ledger since the cursor, grouped into operations. */
  private async enqueueMoves(
    tx: TenantTx,
    organizationId: string,
    since: Date,
    branchIds: string[],
    now: Date,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - SETTLE_MS);
    let rows = await tx.inventoryTransaction.findMany({
      where: {
        branchId: { in: branchIds },
        type: { in: [...MOVE_TYPES] },
        createdAt: { gte: since, lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: MOVE_SCAN_ROWS,
    });
    let cursor = cutoff;
    if (rows.length === MOVE_SCAN_ROWS) {
      // a full page: stop at a moment, so no operation is cut in two, and carry on from there next time
      const last = rows[rows.length - 1].createdAt.getTime();
      rows = rows.filter((r) => r.createdAt.getTime() < last);
      cursor = new Date(last);
    }
    const groups = groupMoves(
      rows.map((r) => ({
        id: r.id,
        branchId: r.branchId,
        variantId: r.variantId,
        type: r.type,
        quantityDelta: Number(r.quantityDelta),
        referenceId: r.referenceId,
        createdAt: r.createdAt,
      })),
    );
    let queued = 0;
    if (groups.length) {
      const r = await tx.etimsDocument.createMany({
        data: groups.map((g) => ({
          organizationId,
          branchId: g.branchId,
          kind: 'STOCK_MOVE' as const,
          sourceKey: g.key,
          // nothing is sold: the first step is already done, and the movement's own details wait in the payload
          saleDone: true,
          payload: {
            ...blankPayload(g.at),
            sarTyCd: g.sarTyCd,
            moveRows: g.rows,
          } as unknown as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      queued = r.count;
    }
    await tx.etimsSetting.updateMany({ data: { stockScannedAt: cursor } });
    return queued;
  }

  /** One pass for this business: pick up what is new, then send what is due. */
  async runPass(now: Date = new Date()): Promise<PassResult> {
    const result: PassResult = {
      queued: await this.enqueue(now),
      sent: 0,
      rejected: 0,
      waiting: 0,
      stopped: null,
    };
    const due = await this.tenantPrisma.run((tx) =>
      tx.etimsDocument.findMany({
        where: {
          status: 'PENDING',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
        take: SEND_BATCH,
      }),
    );
    for (const { id } of due) {
      const outcome = await this.process(id, now);
      if (outcome === 'SENT') result.sent += 1;
      else if (outcome === 'REJECTED' || outcome === 'MANUAL')
        result.rejected += 1;
      else if (outcome === 'WAITING') result.waiting += 1;
      else if (outcome.startsWith('STOP:')) {
        result.stopped = outcome.slice(5);
        break; // KRA cannot be reached or the device is refused: the rest would fail the same way
      }
    }
    return result;
  }

  private async settle(
    id: string,
    status: EtimsDocStatus,
    data: Prisma.EtimsDocumentUncheckedUpdateInput,
  ) {
    await this.tenantPrisma.run((tx) =>
      tx.etimsDocument.update({ where: { id }, data: { status, ...data } }),
    );
  }

  /** Sends one document, carrying on from the step it had reached. */
  async process(
    id: string,
    now: Date = new Date(),
  ): Promise<
    'SENT' | 'REJECTED' | 'MANUAL' | 'WAITING' | 'SKIPPED' | `STOP:${string}`
  > {
    const prep = await this.tenantPrisma.run((tx) => this.prepare(tx, id, now));
    if (prep.kind === 'skip') return 'SKIPPED';
    if (prep.kind === 'manual') {
      await this.settle(id, 'MANUAL', {
        lastError: prep.message,
        nextAttemptAt: null,
      });
      return 'MANUAL';
    }
    if (prep.kind === 'done') {
      await this.settle(id, 'SENT', {
        saleDone: true,
        stockDone: true,
        masterDone: true,
        sentAt: new Date(),
        lastError: null,
        nextAttemptAt: null,
      });
      return 'SENT';
    }
    if (prep.kind === 'wait') {
      await this.settle(id, 'PENDING', {
        lastError: prep.message,
        nextAttemptAt: new Date(now.getTime() + WAIT_FOR_ITEMS_MIN * 60_000),
      });
      return 'WAITING';
    }
    const { doc, creds, p } = prep;
    const credit = doc.kind === 'CREDIT_NOTE';
    const at = new Date(p.at);

    const fail = async (
      res: { resultCd: string; resultMsg: string },
      what: string,
    ) => {
      const kind = classifyResult(res.resultCd);
      const message =
        `${what}: ${explainResult(res.resultCd, res.resultMsg)}`.slice(0, 500);
      if (kind === 'FIX') {
        await this.settle(id, 'REJECTED', {
          lastError: message,
          nextAttemptAt: null,
          attempts: { increment: 1 },
        });
        return 'REJECTED' as const;
      }
      await this.settle(id, 'PENDING', {
        lastError: message,
        attempts: { increment: 1 },
        nextAttemptAt: new Date(
          now.getTime() + backoffMinutes(doc.attempts + 1) * 60_000,
        ),
      });
      return `STOP:${message}` as const;
    };
    const good = (code: string) =>
      ['OK', 'DUPLICATE', 'NO_DATA'].includes(classifyResult(code));

    // 1. the sale itself, or the purchase being confirmed (a stock movement has no such step)
    if (!doc.saleDone) {
      if (doc.kind === 'PURCHASE') {
        const pur = p.purchase!;
        const res = await this.client.call(
          creds.environment,
          'insertTrnsPurchase',
          buildPurchaseBody({
            creds,
            invcNo: doc.invcNo!,
            supplier: pur.supplier,
            regTyCd: pur.regTyCd,
            pmtTyCd: p.pmtTyCd,
            at,
            purchaseDate: pur.purchaseDate,
            lines: p.lines as PurchaseLine[],
            totals: taxTotals(p.lines, p.rates),
            registrant: p.registrant,
          }),
        );
        if (!good(res.resultCd)) return fail(res, 'Confirming the purchase');
        await this.tenantPrisma.run((tx) =>
          tx.etimsDocument.update({
            where: { id },
            data: { saleDone: true, lastError: null },
          }),
        );
      } else {
        const body = buildSalesBody({
          creds,
          invcNo: doc.invcNo!,
          trdInvcNo: credit ? doc.refundId! : doc.saleId!,
          orgInvcNo: p.orgInvcNo,
          credit: credit
            ? { at: new Date(p.creditAt ?? p.at), reasonCd: REFUND_REASON }
            : null,
          at,
          customerName: p.customerName,
          customerPhone: p.customerPhone,
          pmtTyCd: p.pmtTyCd,
          lines: p.lines,
          totals: taxTotals(p.lines, p.rates),
          registrant: p.registrant,
          business: p.business,
        });
        const res = await this.client.call<Record<string, unknown>>(
          creds.environment,
          'saveTrnsSalesOsdc',
          body,
        );
        if (!good(res.resultCd)) return fail(res, 'Sending the sale');
        const d = (res.data ?? {}) as Record<string, unknown>;
        const num = (v: unknown) =>
          typeof v === 'number'
            ? v
            : Number.isFinite(Number(v)) && v !== null && v !== ''
              ? Number(v)
              : null;
        const str = (v: unknown) =>
          typeof v === 'string' ? v.slice(0, 1000) : null;
        await this.tenantPrisma.run((tx) =>
          tx.etimsDocument.update({
            where: { id },
            data: {
              saleDone: true,
              curRcptNo: num(d.curRcptNo),
              totRcptNo: num(d.totRcptNo),
              intrlData: str(d.intrlData),
              rcptSign: str(d.rcptSign),
              sdcDateTime: str(d.sdcDateTime),
              lastError: null,
            },
          }),
        );
      }
    }

    // 2. the stock movement (not for services; a purchase's goods come in through the delivery that brought them)
    const stockLines = p.lines.filter(tracksStock);
    if (!doc.stockDone) {
      if (stockLines.length > 0 && doc.kind !== 'PURCHASE') {
        const res = await this.client.call(
          creds.environment,
          'insertStockIO',
          buildStockIoBody({
            creds,
            sarNo: doc.sarNo!,
            sarTyCd: p.sarTyCd ?? (credit ? '03' : '11'),
            at,
            lines: p.lines,
            registrant: p.registrant,
          }),
        );
        if (!good(res.resultCd)) return fail(res, 'Sending the stock movement');
      }
      await this.tenantPrisma.run((tx) =>
        tx.etimsDocument.update({
          where: { id },
          data: { stockDone: true, lastError: null },
        }),
      );
    }

    // 3. how many are left of each item
    if (!doc.masterDone) {
      if (stockLines.length > 0 && doc.kind !== 'PURCHASE') {
        const left = await this.tenantPrisma.run((tx) =>
          tx.inventoryItem.findMany({
            where: {
              branchId: doc.branchId,
              variantId: { in: stockLines.map((l) => l.variantId) },
            },
            select: { variantId: true, quantity: true },
          }),
        );
        const qty = new Map(left.map((r) => [r.variantId, Number(r.quantity)]));
        for (const l of stockLines) {
          const res = await this.client.call(
            creds.environment,
            'saveStockMaster',
            buildStockMasterBody(
              creds,
              l.itemCd,
              qty.get(l.variantId) ?? 0,
              p.registrant,
            ),
          );
          if (!good(res.resultCd))
            return fail(res, `Sending the stock level of ${l.itemNm}`);
        }
      }
      await this.tenantPrisma.run((tx) =>
        tx.etimsDocument.update({ where: { id }, data: { masterDone: true } }),
      );
    }

    await this.settle(id, 'SENT', {
      sentAt: new Date(),
      lastError: null,
      nextAttemptAt: null,
    });
    return 'SENT';
  }

  /**
   * How KRA knows each product: its item code, classification and units, and the tax type it was registered under (the owner's
   * choice, or the one worked out from the tax class). A product that is not registered yet has no entry, and so cannot be reported.
   */
  async lineInfos(
    tx: TenantTx,
    environment: EtimsEnvironment,
    variants: VariantForLines[],
  ) {
    const rateRows = await tx.etimsCode.findMany({
      where: { environment, cdCls: '04', useYn: 'Y' },
    });
    const taxCodes = rateRows.map((r) => ({ cd: r.cd, rate: r.userDfnCd1 }));
    const infos = new Map<string, LineInfo | null>();
    for (const v of variants) {
      const m = v.etimsItem;
      if (!m || m.status !== 'REGISTERED' || !m.itemCd || !m.itemClsCd) {
        infos.set(v.id, null);
        continue;
      }
      const tc = v.product.taxClass;
      const taxTyCd =
        m.taxTyCd ??
        mapTaxType(
          tc ? { rate: Number(tc.rate), isExempt: tc.isExempt } : null,
          taxCodes,
        ).code;
      infos.set(
        v.id,
        taxTyCd
          ? {
              itemCd: m.itemCd,
              itemClsCd: m.itemClsCd,
              itemTyCd: m.itemTyCd,
              itemNm: itemName(v.product.name, v.name),
              bcd: v.barcode,
              pkgUnitCd: m.pkgUnitCd,
              qtyUnitCd: m.qtyUnitCd,
              taxTyCd,
            }
          : null,
      );
    }
    const rates: Partial<Record<TaxLetter, number>> = {};
    for (const r of rateRows)
      if (r.userDfnCd1 && /^[A-E]$/.test(r.cd))
        rates[r.cd as TaxLetter] = Number(r.userDfnCd1);
    return { infos, rates };
  }

  /**
   * Gets a document ready: claims it, gives it its numbers the first time, and works out what will be sent. Returns why it cannot go
   * yet when it cannot: 'wait' (a product is not registered with KRA yet), 'manual' (it cannot be sent by this system) or 'done'
   * (there turned out to be nothing to report).
   */
  private async prepare(tx: TenantTx, id: string, now: Date) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'etims-doc:' + id}))`;
    const doc = await tx.etimsDocument.findUnique({ where: { id } });
    if (!doc || doc.status !== 'PENDING') return { kind: 'skip' as const };
    if (doc.nextAttemptAt && doc.nextAttemptAt > now)
      return { kind: 'skip' as const };
    const creds = await this.settings.credentials(tx, doc.branchId);
    if (!creds)
      return {
        kind: 'wait' as const,
        message: 'This branch has no connected KRA device',
      };

    let stored = doc.payload as unknown as StoredPayload | null;
    if (doc.kind === 'STOCK_MOVE') {
      if (!stored?.moveRows)
        return {
          kind: 'manual' as const,
          message: 'This movement has lost its details',
        };
      if (stored.lines.length === 0) {
        const built = await this.buildMove(tx, creds.environment, stored);
        if (built.kind !== 'ok') return built;
        stored = built.payload;
      }
    } else if (doc.kind === 'PURCHASE') {
      if (!stored?.purchase)
        return {
          kind: 'manual' as const,
          message: 'This purchase has lost its details',
        };
    } else {
      const made = await this.buildSaleDocument(
        tx,
        doc,
        creds.environment,
        stored,
      );
      if (made.kind !== 'ok') return made;
      stored = made.payload;
    }

    // numbers are made once and kept for every retry: an invoice number (a purchase has its own run), and a stock movement number
    const purchase = doc.kind === 'PURCHASE';
    const needInvc = doc.kind !== 'STOCK_MOVE' && doc.invcNo === null;
    const needSar = !purchase && doc.sarNo === null;
    let invcNo = doc.invcNo;
    let sarNo = doc.sarNo;
    if (needInvc || needSar) {
      const rows = await tx.$queryRaw<
        { invcSeq: number; sarSeq: number; pchsSeq: number }[]
      >`UPDATE etims_devices SET "invcSeq" = "invcSeq" + ${needInvc && !purchase ? 1 : 0}, "sarSeq" = "sarSeq" + ${needSar ? 1 : 0}, "pchsSeq" = "pchsSeq" + ${needInvc && purchase ? 1 : 0} WHERE "branchId" = ${doc.branchId} RETURNING "invcSeq", "sarSeq", "pchsSeq"`;
      if (!rows[0])
        return {
          kind: 'wait' as const,
          message: 'This branch has no connected KRA device',
        };
      if (needInvc) invcNo = purchase ? rows[0].pchsSeq : rows[0].invcSeq;
      if (needSar) sarNo = rows[0].sarSeq;
    }
    const claimed = await tx.etimsDocument.update({
      where: { id },
      data: {
        invcNo,
        sarNo,
        payload: stored as unknown as Prisma.InputJsonValue,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    return { kind: 'send' as const, doc: claimed, creds, p: stored! };
  }

  /** A stock movement's lines: each product as KRA knows it, valued at its cost (before tax, with the tax on top). */
  private async buildMove(
    tx: TenantTx,
    environment: EtimsEnvironment,
    stored: StoredPayload,
  ) {
    const rows = stored.moveRows ?? [];
    const variants = await tx.productVariant.findMany({
      where: { id: { in: rows.map((r) => r.variantId) } },
      include: VARIANT_FOR_LINES,
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const { infos, rates } = await this.lineInfos(tx, environment, variants);
    const present = rows.filter((r) => byId.has(r.variantId));
    const list = present.map((r) => infos.get(r.variantId) ?? null);
    const names = present.map((r) => byId.get(r.variantId)!.product.name);
    const lineInput = present.map((r) => {
      const v = byId.get(r.variantId)!;
      const cost = v.cost === null ? 0 : Number(v.cost);
      const rate =
        v.product.taxClass && !v.product.taxClass.isExempt
          ? Number(v.product.taxClass.rate)
          : 0;
      return {
        variantId: r.variantId,
        quantity: r.quantity,
        unitPrice: cost,
        taxAmount: Math.round(cost * r.quantity * rate * 100) / 100,
      };
    });
    const why = unsendableReason(lineInput, list, names);
    if (why) return { kind: 'wait' as const, message: why };
    const total =
      lineInput.reduce(
        (s, l) =>
          s +
          Math.round(l.unitPrice * l.quantity * 100) +
          Math.round(l.taxAmount * 100),
        0,
      ) / 100;
    let lines: KraLine[];
    try {
      lines = buildLines(lineInput, list as LineInfo[], total).filter(
        tracksStock,
      );
    } catch (e) {
      if (e instanceof SaleDoesNotAddUp)
        return { kind: 'manual' as const, message: e.message };
      throw e;
    }
    // services keep no stock: a movement made only of them has nothing to report
    if (lines.length === 0) return { kind: 'done' as const };
    lines.forEach((l, i) => (l.itemSeq = i + 1));
    return {
      kind: 'ok' as const,
      payload: { ...stored, lines, rates } as StoredPayload,
    };
  }

  /** A sale's or credit note's content, worked out from the sale (the first time; after that it is read back from the document). */
  private async buildSaleDocument(
    tx: TenantTx,
    doc: Prisma.EtimsDocumentGetPayload<object>,
    environment: EtimsEnvironment,
    stored: StoredPayload | null,
  ) {
    const credit = doc.kind === 'CREDIT_NOTE';
    const sale = await tx.sale.findUnique({
      where: { id: doc.saleId! },
      include: {
        lineItems: {
          include: { variant: { include: VARIANT_FOR_LINES } },
          orderBy: { id: 'asc' },
        },
        payments: true,
        customer: true,
        cashier: { include: { user: { select: { fullName: true } } } },
        refunds: true,
      },
    });
    if (!sale)
      return { kind: 'manual' as const, message: 'The sale no longer exists' };
    if (!credit && sale.status === 'VOIDED' && !doc.saleDone)
      return {
        kind: 'manual' as const,
        message: 'The sale was voided before it was sent, so it was not sent',
      };
    if (stored) return { kind: 'ok' as const, payload: stored };

    if (credit) {
      const original = await tx.etimsDocument.findFirst({
        where: { kind: 'SALE', saleId: doc.saleId },
      });
      if (
        !original ||
        original.status === 'REJECTED' ||
        original.status === 'MANUAL'
      )
        return {
          kind: 'manual' as const,
          message:
            'The sale this refund belongs to was never sent to KRA, so there is nothing to reverse',
        };
      if (!original.saleDone || !original.invcNo || !original.payload)
        return {
          kind: 'wait' as const,
          message: 'Waiting for the sale itself to reach KRA',
        };
      const refund = sale.refunds.find((r) => r.id === doc.refundId);
      const refunded = sale.refunds.reduce((s, r) => s + Number(r.amount), 0);
      if (
        !refund ||
        sale.refunds.length !== 1 ||
        Math.abs(Number(refund.amount) - Number(sale.total)) > 0.005 ||
        Math.abs(refunded - Number(sale.total)) > 0.005
      )
        return {
          kind: 'manual' as const,
          message:
            'Only a refund of the whole sale can be sent to KRA by itself. Issue this credit note on the KRA eTIMS portal by hand.',
        };
      return {
        kind: 'ok' as const,
        payload: {
          ...(original.payload as unknown as StoredPayload),
          creditAt: refund.createdAt.toISOString(),
          orgInvcNo: original.invcNo,
        },
      };
    }

    const { infos, rates } = await this.lineInfos(
      tx,
      environment,
      sale.lineItems.map((l) => l.variant),
    );
    const list = sale.lineItems.map((l) => infos.get(l.variantId) ?? null);
    const names = sale.lineItems.map((l) => l.variant.product.name);
    const lineInput = sale.lineItems.map((l) => ({
      variantId: l.variantId,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxAmount: Number(l.taxAmount),
    }));
    const why = unsendableReason(lineInput, list, names);
    if (why) return { kind: 'wait' as const, message: why };
    let lines: KraLine[];
    try {
      lines = buildLines(lineInput, list as LineInfo[], Number(sale.total));
    } catch (e) {
      if (e instanceof SaleDoesNotAddUp)
        return { kind: 'manual' as const, message: e.message };
      throw e;
    }
    const branch = await tx.branch.findUnique({
      where: { id: doc.branchId },
      include: { organization: { select: { name: true } } },
    });
    return {
      kind: 'ok' as const,
      payload: {
        at: sale.createdAt.toISOString(),
        creditAt: null,
        lines,
        pmtTyCd: paymentCode(
          sale.payments.map((p) => ({
            method: p.method,
            amount: Number(p.amount),
          })),
        ),
        customerName: sale.customer?.name ?? null,
        customerPhone: sale.customer?.phone ?? null,
        rates,
        business: {
          name: branch?.organization.name ?? 'Shop',
          address:
            [branch?.name, branch?.subCounty, branch?.county]
              .filter(Boolean)
              .join(', ') || null,
        },
        registrant: {
          id: sale.cashierOrgUserId ?? sale.cashierSessionId,
          name: sale.cashier?.user.fullName ?? 'Cashier',
        },
        orgInvcNo: 0,
      } as StoredPayload,
    };
  }

  // ───────── screens ─────────

  private view(d: Prisma.EtimsDocumentGetPayload<object>) {
    return {
      id: d.id,
      kind: d.kind,
      saleId: d.saleId,
      refundId: d.refundId,
      purchaseInvoiceId: d.purchaseInvoiceId,
      receiptId: d.receiptId,
      status: d.status,
      invcNo: d.invcNo,
      steps: {
        sale: d.saleDone,
        stock: d.stockDone,
        stockLevels: d.masterDone,
      },
      curRcptNo: d.curRcptNo,
      rcptSign: d.rcptSign,
      intrlData: d.intrlData,
      sdcDateTime: d.sdcDateTime,
      /** For a stock movement: what kind (KRA's movement type), so the screen can say it in words. */
      movement:
        d.kind === 'STOCK_MOVE'
          ? ((d.payload as unknown as StoredPayload | null)?.sarTyCd ?? null)
          : null,
      attempts: d.attempts,
      lastError: d.lastError,
      nextAttemptAt: d.nextAttemptAt,
      sentAt: d.sentAt,
      createdAt: d.createdAt,
    };
  }

  async list(query: { status?: EtimsDocStatus; page?: number }) {
    return this.tenantPrisma.run(async (tx) => {
      const grouped = await tx.etimsDocument.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      const counts: Record<EtimsDocStatus, number> = {
        PENDING: 0,
        SENT: 0,
        REJECTED: 0,
        MANUAL: 0,
      };
      for (const g of grouped) counts[g.status] = g._count._all;
      const page = Math.max(1, query.page ?? 1);
      const where = query.status ? { status: query.status } : {};
      const [rows, total] = await Promise.all([
        tx.etimsDocument.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
        tx.etimsDocument.count({ where }),
      ]);
      return {
        counts,
        total,
        page,
        pageSize: PAGE_SIZE,
        rows: rows.map((d) => this.view(d)),
      };
    });
  }

  async forSale(saleId: string) {
    return this.tenantPrisma.run(async (tx) =>
      (
        await tx.etimsDocument.findMany({
          where: { saleId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((d) => this.view(d)),
    );
  }

  /** Puts a refused document back in the queue (after what KRA complained about was fixed). Steps already done are not repeated. */
  async retry(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const d = await tx.etimsDocument.findUnique({ where: { id } });
      if (!d) throw new NotFoundException('Document not found');
      if (
        d.status !== 'REJECTED' &&
        d.status !== 'MANUAL' &&
        d.status !== 'PENDING'
      )
        throw new BadRequestException('That document was already sent.');
      if (d.status === 'MANUAL')
        throw new BadRequestException(
          'This one cannot be sent by this system; it has to be done on the KRA portal.',
        );
      // a rejected sale whose products were fixed is built again from the sale as it is now (the other kinds keep what they were made of)
      const fresh =
        d.kind === 'SALE' && !d.saleDone ? { payload: Prisma.DbNull } : {};
      return this.view(
        await tx.etimsDocument.update({
          where: { id },
          data: {
            status: 'PENDING',
            attempts: 0,
            nextAttemptAt: null,
            lastError: null,
            ...fresh,
          },
        }),
      );
    });
  }
}

/** For the screens: what a KRA stock movement type means (spec 4.15), in words. */
export const MOVEMENT_WORDS: Record<string, string> = {
  '02': 'Delivery from a supplier',
  '03': 'Returned to stock',
  '04': 'Transfer in',
  '05': 'Made in production or repacking',
  '06': 'Stock added (adjustment)',
  '11': 'Sale',
  '12': 'Returned to the supplier',
  '13': 'Transfer out',
  '14': 'Used in production or repacking',
  '15': 'Thrown away',
  '16': 'Stock taken off (adjustment)',
};
