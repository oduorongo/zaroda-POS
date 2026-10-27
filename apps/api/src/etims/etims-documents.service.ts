import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EtimsDocStatus, Prisma } from '@prisma/client';
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
/** KRA's refund reason code for a plain refund (spec 4.x). */
const REFUND_REASON = '06';

/** What is kept of a document so every retry sends exactly the same thing. */
interface StoredPayload {
  at: string;
  creditAt: string | null;
  lines: KraLine[];
  pmtTyCd: string;
  customerName: string | null;
  customerPhone: string | null;
  customerPin?: string | null;
  rates: Partial<Record<TaxLetter, number>>;
  business: { name: string; address: string | null };
  registrant: Registrant;
  orgInvcNo: number;
}

export interface PassResult {
  queued: number;
  sent: number;
  rejected: number;
  waiting: number;
  stopped: string | null;
}

/**
 * Sales, refunds and stock going to KRA. Each finished sale (and each full refund) becomes one document in a queue; a pass picks up
 * new ones and sends the due ones. A document goes through up to three steps in KRA's required order - the sale, then the stock
 * movement, then the stock level of each item - and remembers each step, so a retry carries on where it stopped and nothing is
 * ever sent twice. The invoice and movement numbers are made once and kept. Nothing here ever blocks or fails a sale.
 */
@Injectable()
export class EtimsDocumentsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly client: EtimsClient,
    private readonly settings: EtimsSettingsService,
  ) {}

  /** Picks up sales and full refunds made since sending was switched on that have no document yet. */
  async enqueue(): Promise<number> {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const setting = await tx.etimsSetting.findFirst();
      if (!setting?.enabled || !setting.sendSales || !setting.salesStartAt)
        return 0;
      const devices = await tx.etimsDevice.findMany({
        where: { status: 'ACTIVE' },
        select: { branchId: true },
      });
      const branchIds = devices.map((d) => d.branchId);
      if (branchIds.length === 0) return 0;
      const known = (keys: string[]) =>
        tx.etimsDocument.findMany({
          where: { sourceKey: { in: keys } },
          select: { sourceKey: true },
        });

      const sales = await tx.sale.findMany({
        where: {
          status: 'COMPLETED',
          branchId: { in: branchIds },
          createdAt: { gte: setting.salesStartAt },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, branchId: true },
        take: ENQUEUE_BATCH * 3,
      });
      const have = new Set(
        (await known(sales.map((s) => `SALE:${s.id}`))).map((d) => d.sourceKey),
      );
      const fresh = sales
        .filter((s) => !have.has(`SALE:${s.id}`))
        .slice(0, ENQUEUE_BATCH);
      if (fresh.length)
        await tx.etimsDocument.createMany({
          data: fresh.map((s) => ({
            organizationId,
            branchId: s.branchId,
            kind: 'SALE' as const,
            saleId: s.id,
            sourceKey: `SALE:${s.id}`,
          })),
          skipDuplicates: true,
        });

      // a refund of a sale that KRA has (or is about to have) becomes a credit note
      const refunds = await tx.refund.findMany({
        where: {
          createdAt: { gte: setting.salesStartAt },
          sale: { branchId: { in: branchIds } },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          saleId: true,
          sale: { select: { branchId: true } },
        },
        take: ENQUEUE_BATCH * 3,
      });
      const haveR = new Set(
        (await known(refunds.map((r) => `CREDIT:${r.id}`))).map(
          (d) => d.sourceKey,
        ),
      );
      const originals = new Set(
        (
          await tx.etimsDocument.findMany({
            where: {
              kind: 'SALE',
              saleId: { in: refunds.map((r) => r.saleId) },
            },
            select: { saleId: true },
          })
        ).map((d) => d.saleId),
      );
      const freshR = refunds
        .filter((r) => !haveR.has(`CREDIT:${r.id}`) && originals.has(r.saleId))
        .slice(0, ENQUEUE_BATCH);
      if (freshR.length)
        await tx.etimsDocument.createMany({
          data: freshR.map((r) => ({
            organizationId,
            branchId: r.sale.branchId,
            kind: 'CREDIT_NOTE' as const,
            saleId: r.saleId,
            refundId: r.id,
            sourceKey: `CREDIT:${r.id}`,
          })),
          skipDuplicates: true,
        });
      return fresh.length + freshR.length;
    });
  }

  /** One pass for this business: pick up what is new, then send what is due. */
  async runPass(now: Date = new Date()): Promise<PassResult> {
    const result: PassResult = {
      queued: await this.enqueue(),
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

    // 1. the sale itself
    if (!doc.saleDone) {
      const body = buildSalesBody({
        creds,
        invcNo: doc.invcNo!,
        trdInvcNo: credit ? doc.refundId! : doc.saleId,
        orgInvcNo: p.orgInvcNo,
        credit: credit
          ? { at: new Date(p.creditAt ?? p.at), reasonCd: REFUND_REASON }
          : null,
        at,
        customerName: p.customerName,
        customerPhone: p.customerPhone,
        customerPin: p.customerPin ?? null,
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

    // 2. the stock movement (not for services)
    const stockLines = p.lines.filter(tracksStock);
    if (!doc.stockDone) {
      if (stockLines.length > 0) {
        const res = await this.client.call(
          creds.environment,
          'insertStockIO',
          buildStockIoBody({
            creds,
            sarNo: doc.sarNo!,
            sarTyCd: credit ? '03' : '11',
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
      if (stockLines.length > 0) {
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
   * Gets a document ready: claims it, gives it its numbers the first time, and works out what will be sent. Returns why it cannot go
   * yet when it cannot: 'wait' (a product is not registered with KRA yet) or 'manual' (it cannot be sent by this system).
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
    const credit = doc.kind === 'CREDIT_NOTE';

    const sale = await tx.sale.findUnique({
      where: { id: doc.saleId },
      include: {
        lineItems: {
          include: {
            variant: {
              include: {
                product: { include: { taxClass: true } },
                etimsItem: true,
              },
            },
          },
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

    let stored = doc.payload as unknown as StoredPayload | null;
    if (!stored) {
      let originalNo = 0;
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
        originalNo = original.invcNo;
        const o = original.payload as unknown as StoredPayload;
        stored = {
          ...o,
          creditAt: refund.createdAt.toISOString(),
          orgInvcNo: originalNo,
        };
      } else {
        const rateRows = await tx.etimsCode.findMany({
          where: { environment: creds.environment, cdCls: '04', useYn: 'Y' },
        });
        const taxCodes = rateRows.map((r) => ({
          cd: r.cd,
          rate: r.userDfnCd1,
        }));
        const infos = sale.lineItems.map((l): LineInfo | null => {
          const m = l.variant.etimsItem;
          if (!m || m.status !== 'REGISTERED' || !m.itemCd || !m.itemClsCd)
            return null;
          // the tax type is the one the item was registered with: the owner's choice, or the one worked out from the tax class
          const tc = l.variant.product.taxClass;
          const taxTyCd =
            m.taxTyCd ??
            mapTaxType(
              tc ? { rate: Number(tc.rate), isExempt: tc.isExempt } : null,
              taxCodes,
            ).code;
          if (!taxTyCd) return null;
          return {
            itemCd: m.itemCd,
            itemClsCd: m.itemClsCd,
            itemTyCd: m.itemTyCd,
            itemNm: itemName(l.variant.product.name, l.variant.name),
            bcd: l.variant.barcode,
            pkgUnitCd: m.pkgUnitCd,
            qtyUnitCd: m.qtyUnitCd,
            taxTyCd,
          };
        });
        const names = sale.lineItems.map((l) => l.variant.product.name);
        const lineInput = sale.lineItems.map((l) => ({
          variantId: l.variantId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxAmount: Number(l.taxAmount),
        }));
        const why = unsendableReason(lineInput, infos, names);
        if (why) return { kind: 'wait' as const, message: why };
        const rates: Partial<Record<TaxLetter, number>> = {};
        for (const r of rateRows)
          if (r.userDfnCd1 && /^[A-E]$/.test(r.cd))
            rates[r.cd as TaxLetter] = Number(r.userDfnCd1);
        let lines: KraLine[];
        try {
          lines = buildLines(
            lineInput,
            infos as LineInfo[],
            Number(sale.total),
          );
        } catch (e) {
          if (e instanceof SaleDoesNotAddUp)
            return { kind: 'manual' as const, message: e.message };
          throw e;
        }
        const branch = await tx.branch.findUnique({
          where: { id: doc.branchId },
          include: { organization: { select: { name: true } } },
        });
        stored = {
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
          customerPin: sale.customer?.kraPin ?? null,
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
        };
      }
    }

    // numbers are made once and kept for every retry
    let invcNo = doc.invcNo;
    let sarNo = doc.sarNo;
    if (invcNo === null || sarNo === null) {
      const rows = await tx.$queryRaw<
        { invcSeq: number; sarSeq: number }[]
      >`UPDATE etims_devices SET "invcSeq" = "invcSeq" + ${invcNo === null ? 1 : 0}, "sarSeq" = "sarSeq" + ${sarNo === null ? 1 : 0} WHERE "branchId" = ${doc.branchId} RETURNING "invcSeq", "sarSeq"`;
      if (!rows[0])
        return {
          kind: 'wait' as const,
          message: 'This branch has no connected KRA device',
        };
      invcNo = invcNo ?? rows[0].invcSeq;
      sarNo = sarNo ?? rows[0].sarSeq;
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
    return { kind: 'send' as const, doc: claimed, creds, p: stored };
  }

  // ───────── screens ─────────

  private view(d: Prisma.EtimsDocumentGetPayload<object>) {
    return {
      id: d.id,
      kind: d.kind,
      saleId: d.saleId,
      refundId: d.refundId,
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
      // a rejected sale whose products were fixed is built again from the sale as it is now
      const fresh = !d.saleDone ? { payload: Prisma.DbNull } : {};
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
