import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { EtimsClient } from './etims.client';
import { EtimsSettingsService } from './etims-settings.service';
import { classifyResult, explainResult, INITIAL_LAST_REQ } from './etims.util';
import { customerKey, importDecisionProblem, normalizeCustPin, stampBefore } from './etims-extras.util';

const REGISTRANT = { id: 'ZARODA', name: 'Zaroda POS' };

const str = (v: unknown, max?: number): string | null =>
  typeof v === 'string' && v.trim() ? (max ? v.slice(0, max) : v) : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

interface PinRow {
  tin?: string;
  taxprNm?: string;
  taxprSttsCd?: string;
  prvncNm?: string;
  dstrtNm?: string;
  sctrNm?: string;
  locDesc?: string;
}
interface BranchRow {
  bhfId?: string;
  bhfNm?: string;
  bhfSttsCd?: string;
  prvncNm?: string;
  dstrtNm?: string;
  sctrNm?: string;
  locDesc?: string;
  mgrNm?: string;
  mgrTelNo?: string;
  mgrEmail?: string;
  hqYn?: string;
}
interface NoticeRow {
  noticeNo?: number;
  title?: string;
  cont?: string;
  dtlUrl?: string;
  regrNm?: string;
  regDt?: string;
}
interface ImportRow {
  taskCd?: string;
  dclDe?: string;
  itemSeq?: number;
  dclNo?: string;
  hsCd?: string;
  itemNm?: string;
  imptItemsttsCd?: string;
  imptItemSttsCd?: string;
  orgnNatCd?: string;
  exptNatCd?: string;
  pkg?: number;
  pkgUnitCd?: string;
  qty?: number;
  qtyUnitCd?: string;
  totWt?: number;
  netWt?: number;
  spplrNm?: string;
  agntNm?: string;
  invcFcurAmt?: number;
  invcFcurCd?: string;
  invcFcurExcrt?: number;
}

/**
 * The other things the OSCU specification has a business do with KRA, beyond selling: look up a PIN, read KRA's notices and branch
 * list, approve or cancel the items customs declared under the business's PIN, and tell KRA about customers that have a PIN.
 * Everything goes through the business's connected device; nothing here ever blocks a sale.
 */
@Injectable()
export class EtimsExtrasService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly client: EtimsClient,
    private readonly settings: EtimsSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  private async creds() {
    const c = await this.tenantPrisma.run((tx) =>
      this.settings.credentials(tx),
    );
    if (!c)
      throw new BadRequestException(
        'Connect a branch to KRA first (Settings, eTIMS).',
      );
    return c;
  }

  private fail(code: string, message: string): never {
    throw new BadRequestException(explainResult(code, message));
  }

  // ── PIN lookup (selectCustomer) ──
  /** What KRA knows about a PIN: the taxpayer's name, whether it is active, and where it is. */
  async lookupPin(raw: string) {
    const tin = normalizeCustPin(raw);
    if (!tin)
      throw new BadRequestException(
        'A KRA PIN is a letter, nine digits and a letter, e.g. A123456789Z',
      );
    const c = await this.creds();
    const res = await this.client.call<{ custList?: PinRow[] }>(
      c.environment,
      'selectCustomer',
      { tin: c.tin, bhfId: c.bhfId, cmcKey: c.cmcKey, custmTin: tin },
    );
    if (res.resultCd === '001')
      return { found: false as const, pin: tin, message: 'KRA has no taxpayer with that PIN.' };
    if (classifyResult(res.resultCd) !== 'OK')
      this.fail(res.resultCd, res.resultMsg);
    const row = res.data?.custList?.[0];
    if (!row) return { found: false as const, pin: tin, message: 'KRA has no taxpayer with that PIN.' };
    return {
      found: true as const,
      pin: row.tin ?? tin,
      name: row.taxprNm ?? null,
      active: row.taxprSttsCd === 'A',
      status: row.taxprSttsCd === 'A' ? 'Active' : row.taxprSttsCd === 'D' ? 'Inactive' : (row.taxprSttsCd ?? null),
      county: row.prvncNm ?? null,
      subCounty: row.dstrtNm ?? null,
      locality: row.sctrNm ?? null,
      location: row.locDesc ?? null,
    };
  }

  // ── KRA's list of the business's branches (selectBhfList) ──
  async branches() {
    const c = await this.creds();
    const res = await this.client.call<{ bhfList?: BranchRow[] }>(
      c.environment,
      'selectBhfList',
      { tin: c.tin, bhfId: c.bhfId, cmcKey: c.cmcKey, lastReqDt: INITIAL_LAST_REQ },
    );
    if (res.resultCd === '001') return [];
    if (classifyResult(res.resultCd) !== 'OK')
      this.fail(res.resultCd, res.resultMsg);
    return (res.data?.bhfList ?? []).map((b) => ({
      bhfId: b.bhfId ?? '',
      name: b.bhfNm ?? '',
      active: b.bhfSttsCd === '01',
      county: b.prvncNm ?? null,
      location: b.locDesc ?? null,
      manager: b.mgrNm ?? null,
      managerPhone: b.mgrTelNo ?? null,
      headOffice: b.hqYn === 'Y',
    }));
  }

  // ── Notices (selectNoticeList) ──
  async syncNotices() {
    const c = await this.creds();
    const { organizationId } = getTenantStore();
    const setting = await this.tenantPrisma.run((tx) => tx.etimsSetting.findFirst());
    const res = await this.client.call<{ noticeList?: NoticeRow[] }>(
      c.environment,
      'selectNoticeList',
      {
        tin: c.tin,
        bhfId: c.bhfId,
        cmcKey: c.cmcKey,
        lastReqDt: setting?.noticesSyncedAt ?? INITIAL_LAST_REQ,
      },
    );
    if (res.resultCd === '001') return { added: 0 };
    if (classifyResult(res.resultCd) !== 'OK')
      this.fail(res.resultCd, res.resultMsg);
    const list = res.data?.noticeList ?? [];
    let added = 0;
    await this.tenantPrisma.run(async (tx) => {
      for (const n of list) {
        if (typeof n.noticeNo !== 'number') continue;
        const exists = await tx.etimsNotice.findUnique({
          where: { organizationId_noticeNo: { organizationId, noticeNo: n.noticeNo } },
        });
        const data = {
          title: (n.title ?? '').slice(0, 1000),
          content: (n.cont ?? '').slice(0, 4000),
          detailUrl: str(n.dtlUrl, 200),
          postedBy: str(n.regrNm, 60),
          postedAt: str(n.regDt, 14),
        };
        if (exists) await tx.etimsNotice.update({ where: { id: exists.id }, data });
        else {
          await tx.etimsNotice.create({ data: { organizationId, noticeNo: n.noticeNo, ...data } });
          added += 1;
        }
      }
      if (setting)
        await tx.etimsSetting.update({
          where: { id: setting.id },
          data: { noticesSyncedAt: stampBefore(res.resultDt) ?? setting.noticesSyncedAt },
        });
    });
    return { added };
  }

  async notices() {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.etimsNotice.findMany({ orderBy: [{ noticeNo: 'desc' }], take: 100 }),
    );
    return {
      unread: rows.filter((r) => !r.readAt).length,
      rows: rows.map((r) => ({
        id: r.id,
        noticeNo: r.noticeNo,
        title: r.title,
        content: r.content,
        detailUrl: r.detailUrl,
        postedBy: r.postedBy,
        postedAt: r.postedAt,
        read: Boolean(r.readAt),
      })),
    };
  }

  async markNoticeRead(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const n = await tx.etimsNotice.findUnique({ where: { id } });
      if (!n) throw new NotFoundException('Notice not found');
      await tx.etimsNotice.update({ where: { id }, data: { readAt: new Date() } });
      return { id, read: true };
    });
  }

  // ── Imported items (selectImportItemList, updateImportItem) ──
  async syncImports() {
    const c = await this.creds();
    const { organizationId } = getTenantStore();
    const setting = await this.tenantPrisma.run((tx) => tx.etimsSetting.findFirst());
    const res = await this.client.call<{ itemList?: ImportRow[] }>(
      c.environment,
      'selectImportItemList',
      {
        tin: c.tin,
        bhfId: c.bhfId,
        cmcKey: c.cmcKey,
        lastReqDt: setting?.importsSyncedAt ?? INITIAL_LAST_REQ,
      },
    );
    if (res.resultCd === '001') return { added: 0 };
    if (classifyResult(res.resultCd) !== 'OK')
      this.fail(res.resultCd, res.resultMsg);
    const list = res.data?.itemList ?? [];
    let added = 0;
    await this.tenantPrisma.run(async (tx) => {
      for (const i of list) {
        const taskCd = str(i.taskCd, 50);
        const declDate = str(i.dclDe?.trim(), 8) ?? '';
        if (!taskCd || typeof i.itemSeq !== 'number') continue;
        const key = { organizationId, taskCd, declDate, itemSeq: i.itemSeq };
        const data = {
          declNo: str(i.dclNo, 50),
          hsCd: str(i.hsCd, 17),
          itemName: (i.itemNm ?? '').slice(0, 500),
          originCd: str(i.orgnNatCd, 5),
          exportCd: str(i.exptNatCd, 5),
          pkg: num(i.pkg),
          pkgUnitCd: str(i.pkgUnitCd, 5),
          qty: num(i.qty),
          qtyUnitCd: str(i.qtyUnitCd, 5),
          grossWeight: num(i.totWt),
          netWeight: num(i.netWt),
          supplierName: str(i.spplrNm, 500),
          agentName: str(i.agntNm, 500),
          invoiceAmount: num(i.invcFcurAmt),
          invoiceCurrency: str(i.invcFcurCd, 5),
          invoiceRate: num(i.invcFcurExcrt),
        };
        const status = str(i.imptItemSttsCd ?? i.imptItemsttsCd, 5);
        const found = await tx.etimsImport.findUnique({
          where: { organizationId_taskCd_declDate_itemSeq: { organizationId, taskCd, declDate, itemSeq: i.itemSeq } },
        });
        if (found)
          await tx.etimsImport.update({
            where: { id: found.id },
            // what KRA says wins, but a decision we already made is not undone by a stale "waiting"
            data: { ...data, statusCd: found.decidedAt ? found.statusCd : (status ?? found.statusCd) },
          });
        else {
          await tx.etimsImport.create({ data: { ...key, ...data, statusCd: status ?? '2' } });
          added += 1;
        }
      }
      if (setting)
        await tx.etimsSetting.update({
          where: { id: setting.id },
          data: { importsSyncedAt: stampBefore(res.resultDt) ?? setting.importsSyncedAt },
        });
    });
    return { added };
  }

  async imports() {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.etimsImport.findMany({ orderBy: [{ declDate: 'desc' }, { itemSeq: 'asc' }], take: 300 }),
    );
    const variantIds = rows.map((r) => r.variantId).filter((v): v is string => Boolean(v));
    const variants = variantIds.length
      ? await this.tenantPrisma.run((tx) =>
          tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true, name: true, product: { select: { name: true } } },
          }),
        )
      : [];
    const vById = new Map(variants.map((v) => [v.id, v]));
    return rows.map((r) => ({
      id: r.id,
      taskCd: r.taskCd,
      declDate: r.declDate,
      itemSeq: r.itemSeq,
      declNo: r.declNo,
      hsCd: r.hsCd,
      itemName: r.itemName,
      origin: r.originCd,
      exportFrom: r.exportCd,
      quantity: r.qty === null ? null : Number(r.qty),
      quantityUnit: r.qtyUnitCd,
      netWeight: r.netWeight === null ? null : Number(r.netWeight),
      supplierName: r.supplierName,
      agentName: r.agentName,
      invoiceAmount: r.invoiceAmount === null ? null : Number(r.invoiceAmount),
      invoiceCurrency: r.invoiceCurrency,
      status: r.statusCd === '3' ? 'APPROVED' : r.statusCd === '4' ? 'CANCELLED' : r.statusCd === '1' ? 'UNSENT' : 'WAITING',
      product: r.variantId
        ? (() => {
            const v = vById.get(r.variantId);
            return v ? { id: v.id, sku: v.sku, name: v.name ? `${v.product.name} - ${v.name}` : v.product.name } : null;
          })()
        : null,
      remark: r.remark,
      lastError: r.lastError,
    }));
  }

  /** Approve an imported item (matched to one of the business's registered products) or cancel it; KRA is told either way. */
  async decideImport(id: string, decision: 'APPROVE' | 'CANCEL', variantId: string | undefined, remark: string | undefined) {
    const c = await this.creds();
    const { orgUserId } = getTenantStore();
    const row = await this.tenantPrisma.run((tx) => tx.etimsImport.findUnique({ where: { id } }));
    if (!row) throw new NotFoundException('Imported item not found');
    const item = variantId
      ? await this.tenantPrisma.run((tx) => tx.etimsItem.findUnique({ where: { variantId } }))
      : null;
    const problem = importDecisionProblem({
      decision,
      currentStatus: row.statusCd,
      item: item ? { status: item.status, itemCd: item.itemCd, itemClsCd: item.itemClsCd } : null,
      hasVariant: Boolean(variantId),
    });
    if (problem) throw new BadRequestException(problem);
    const res = await this.client.call(c.environment, 'updateImportItem', {
      tin: c.tin,
      bhfId: c.bhfId,
      cmcKey: c.cmcKey,
      taskCd: row.taskCd,
      dclDe: row.declDate,
      itemSeq: row.itemSeq,
      hsCd: row.hsCd ?? '',
      itemClsCd: decision === 'APPROVE' ? item!.itemClsCd : (item?.itemClsCd ?? ''),
      itemCd: decision === 'APPROVE' ? item!.itemCd : (item?.itemCd ?? ''),
      imptItemSttsCd: decision === 'APPROVE' ? '3' : '4',
      remark: remark?.trim() ? remark.trim().slice(0, 400) : null,
      modrId: REGISTRANT.id,
      modrNm: REGISTRANT.name,
    });
    const ok = classifyResult(res.resultCd) === 'OK';
    await this.tenantPrisma.run(async (tx) => {
      await tx.etimsImport.update({
        where: { id },
        data: ok
          ? {
              statusCd: decision === 'APPROVE' ? '3' : '4',
              variantId: variantId ?? null,
              remark: remark?.trim() || null,
              decidedAt: new Date(),
              lastError: null,
            }
          : { lastError: explainResult(res.resultCd, res.resultMsg) },
      });
      if (ok)
        await this.audit.logInTx(tx, {
          action: decision === 'APPROVE' ? 'etims.import_approved' : 'etims.import_cancelled',
          entityType: 'EtimsImport',
          entityId: id,
          after: { declaration: row.declNo, item: row.itemName, userId: orgUserId },
        });
    });
    if (!ok) this.fail(res.resultCd, res.resultMsg);
    return { id, status: decision === 'APPROVE' ? 'APPROVED' : 'CANCELLED' };
  }

  // ── Customers with a KRA PIN (saveBhfCustomer) ──
  /**
   * Tells KRA about each customer that has a PIN (and again when its name or PIN changes). Customer numbers are a 9-digit running
   * number. A failure leaves the customer to be tried at the next pass; it never touches a sale.
   */
  async syncCustomers() {
    const { organizationId } = getTenantStore();
    const c = await this.tenantPrisma.run((tx) => this.settings.credentials(tx));
    if (!c) return { sent: 0, failed: 0 };
    const pending = await this.tenantPrisma.run(async (tx) => {
      const rows = await tx.customer.findMany({
        where: { kraPin: { not: null } },
        select: { id: true, name: true, phone: true, kraPin: true, etimsCustNo: true, etimsSentKey: true },
        take: 200,
      });
      return rows.filter((r) => r.kraPin && customerKey(r.name, r.kraPin) !== r.etimsSentKey);
    });
    let sent = 0;
    let failed = 0;
    for (const cust of pending) {
      const custNo = cust.etimsCustNo ?? (await this.nextCustNo(organizationId));
      const res = await this.client.call(c.environment, 'saveBhfCustomer', {
        tin: c.tin,
        bhfId: c.bhfId,
        cmcKey: c.cmcKey,
        custNo,
        custTin: cust.kraPin,
        custNm: cust.name.slice(0, 60),
        adrs: null,
        telNo: cust.phone ? cust.phone.slice(0, 20) : null,
        email: null,
        faxNo: null,
        useYn: 'Y',
        remark: null,
        regrId: REGISTRANT.id,
        regrNm: REGISTRANT.name,
        modrId: REGISTRANT.id,
        modrNm: REGISTRANT.name,
      });
      if (classifyResult(res.resultCd) === 'OK' || classifyResult(res.resultCd) === 'DUPLICATE') {
        await this.tenantPrisma.run((tx) =>
          tx.customer.update({
            where: { id: cust.id },
            data: { etimsCustNo: custNo, etimsSentKey: customerKey(cust.name, cust.kraPin!) },
          }),
        );
        sent += 1;
      } else {
        // keep the number so the retry sends the same one
        await this.tenantPrisma.run((tx) =>
          tx.customer.update({ where: { id: cust.id }, data: { etimsCustNo: custNo } }),
        );
        failed += 1;
        // the network being down stops the round: the rest would fail the same way
        if (classifyResult(res.resultCd) === 'RETRY') break;
      }
    }
    return { sent, failed };
  }

  private async nextCustNo(organizationId: string): Promise<string> {
    return this.tenantPrisma.run(async (tx) => {
      const s = await tx.etimsSetting.findFirstOrThrow({ where: { organizationId } });
      const updated = await tx.etimsSetting.update({
        where: { id: s.id },
        data: { custSeq: { increment: 1 } },
      });
      return String(updated.custSeq).padStart(9, '0');
    });
  }
}
