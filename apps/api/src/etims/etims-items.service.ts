import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EtimsEnvironment, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { UpdateEtimsItemDto } from './dto/etims-items.dto';
import { EtimsClient } from './etims.client';
import { EtimsSettingsService } from './etims-settings.service';
import {
  buildItemCode,
  buildSaveItemBody,
  inclusivePrice,
  ItemFields,
  itemFingerprint,
  itemName,
  itemState,
  ItemState,
  mapTaxType,
  setupProblems,
  TaxCode,
} from './etims-items.util';
import { classifyResult, explainResult } from './etims.util';

const PAGE_SIZE = 50;
/** How many items one "register" request sends: each is a call to KRA, so a big catalogue goes in rounds. */
export const REGISTER_BATCH = 100;
const MAX_CATALOGUE = 5000;

interface Codes {
  tax: TaxCode[];
  units: Set<string>;
  packaging: Set<string>;
  types: Set<string>;
}

const VARIANT_INCLUDE = {
  product: { include: { taxClass: true } },
  etimsItem: true,
  hotelRoomType: { select: { id: true } },
} satisfies Prisma.ProductVariantInclude;
type VariantRow = Prisma.ProductVariantGetPayload<{
  include: typeof VARIANT_INCLUDE;
}>;

/**
 * Products as KRA knows them. Every product option has to be registered with KRA (/saveItem) before it can be sold on an eTIMS
 * receipt. The owner picks KRA's classification for each (the tax type, units and item type are worked out and can be changed); each
 * gets a unique item code the first time it is sent. What KRA was last told is fingerprinted, so a later change shows as "needs update".
 */
@Injectable()
export class EtimsItemsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
    private readonly client: EtimsClient,
    private readonly settings: EtimsSettingsService,
  ) {}

  private async environment(tx: TenantTx): Promise<EtimsEnvironment> {
    return (await tx.etimsSetting.findFirst())?.environment ?? 'SANDBOX';
  }

  private async codes(
    tx: TenantTx,
    environment: EtimsEnvironment,
  ): Promise<Codes> {
    const rows = await tx.etimsCode.findMany({
      where: {
        environment,
        cdCls: { in: ['04', '10', '17', '24'] },
        useYn: 'Y',
      },
    });
    const set = (cls: string) =>
      new Set(rows.filter((r) => r.cdCls === cls).map((r) => r.cd));
    return {
      tax: rows
        .filter((r) => r.cdCls === '04')
        .map((r) => ({ cd: r.cd, rate: r.userDfnCd1 })),
      units: set('10'),
      packaging: set('17'),
      types: set('24'),
    };
  }

  /** Everything known about one product option, and what KRA would be sent. */
  private describe(v: VariantRow, codes: Codes) {
    const m = v.etimsItem;
    const rate = v.product.taxClass ? Number(v.product.taxClass.rate) : 0;
    const mapped = mapTaxType(
      v.product.taxClass
        ? { rate, isExempt: v.product.taxClass.isExempt }
        : null,
      codes.tax,
    );
    const taxTyCd = m?.taxTyCd ?? mapped.code;
    const taxProblem = m?.taxTyCd ? null : mapped.problem;
    const itemTyCd = m?.itemTyCd ?? (v.hotelRoomType ? '3' : '2');
    const pkgUnitCd = m?.pkgUnitCd ?? 'NT';
    const qtyUnitCd =
      m?.qtyUnitCd ?? (v.quantityMode === 'WEIGHT' ? 'KG' : 'U');
    const name = itemName(v.product.name, v.name);
    const price = Number(v.price);
    const fieldsWithoutCode =
      m?.itemClsCd && taxTyCd
        ? {
            itemClsCd: m.itemClsCd,
            itemTyCd,
            itemNm: name,
            bcd: v.barcode,
            pkgUnitCd,
            qtyUnitCd,
            taxTyCd,
            dftPrc: inclusivePrice(price, rate),
            useYn: (v.product.isActive ? 'Y' : 'N') as 'Y' | 'N',
          }
        : null;
    const currentHash = fieldsWithoutCode
      ? itemFingerprint(fieldsWithoutCode)
      : null;
    const state: ItemState = itemState({
      itemClsCd: m?.itemClsCd ?? null,
      taxProblem,
      status: m?.status ?? 'NOT_SENT',
      sentHash: m?.sentHash ?? null,
      currentHash,
    });
    return {
      m,
      rate,
      taxTyCd,
      taxProblem,
      itemTyCd,
      pkgUnitCd,
      qtyUnitCd,
      name,
      price,
      fieldsWithoutCode,
      currentHash,
      state,
    };
  }

  private rowView(v: VariantRow, d: ReturnType<EtimsItemsService['describe']>) {
    return {
      variantId: v.id,
      sku: v.sku,
      name: d.name,
      price: d.price,
      barcode: v.barcode,
      archived: !v.product.isActive,
      taxClass: v.product.taxClass
        ? {
            name: v.product.taxClass.name,
            percent: Math.round(d.rate * 10000) / 100,
            isExempt: v.product.taxClass.isExempt,
          }
        : null,
      itemClsCd: d.m?.itemClsCd ?? null,
      itemTyCd: d.itemTyCd,
      pkgUnitCd: d.pkgUnitCd,
      qtyUnitCd: d.qtyUnitCd,
      taxTyCd: d.taxTyCd,
      taxTyOverridden: Boolean(d.m?.taxTyCd),
      itemCd: d.m?.itemCd ?? null,
      state: d.state,
      problems: setupProblems({
        itemClsCd: d.m?.itemClsCd ?? null,
        taxProblem: d.taxProblem,
        name: d.name,
        price: d.price,
      }),
      lastError: d.m?.lastError ?? null,
      registeredAt: d.m?.registeredAt ?? null,
    };
  }

  private async loadAll(
    tx: TenantTx,
    search?: string,
    includeArchived = false,
  ) {
    const term = search?.trim();
    return tx.productVariant.findMany({
      where: {
        ...(includeArchived ? {} : { product: { isActive: true } }),
        ...(term
          ? {
              OR: [
                { sku: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
                { barcode: { contains: term } },
                { product: { name: { contains: term, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: VARIANT_INCLUDE,
      orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      take: MAX_CATALOGUE,
    });
  }

  /** The catalogue as KRA sees it, one page, with how many items are in each state. */
  async list(query: { search?: string; state?: ItemState; page?: number }) {
    return this.tenantPrisma.run(async (tx) => {
      const environment = await this.environment(tx);
      const codes = await this.codes(tx, environment);
      const variants = await this.loadAll(tx, query.search);
      const rows = variants.map((v) => ({ v, d: this.describe(v, codes) }));
      const counts: Record<ItemState, number> = {
        NEEDS_SETUP: 0,
        READY: 0,
        REGISTERED: 0,
        NEEDS_UPDATE: 0,
        REJECTED: 0,
      };
      for (const r of rows) counts[r.d.state] += 1;
      const filtered = query.state
        ? rows.filter((r) => r.d.state === query.state)
        : rows;
      const page = Math.max(1, query.page ?? 1);
      return {
        counts,
        total: filtered.length,
        page,
        pageSize: PAGE_SIZE,
        listsDownloaded: codes.tax.length > 0,
        rows: filtered
          .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
          .map((r) => this.rowView(r.v, r.d)),
      };
    });
  }

  /** Checks the owner's choices against KRA's downloaded lists. */
  private async validateChoices(
    tx: TenantTx,
    environment: EtimsEnvironment,
    dto: UpdateEtimsItemDto,
  ) {
    const codes = await this.codes(tx, environment);
    if (dto.itemClsCd !== undefined) {
      const cls = await tx.etimsItemClass.findUnique({
        where: {
          environment_itemClsCd: { environment, itemClsCd: dto.itemClsCd },
        },
      });
      if (!cls || cls.useYn !== 'Y')
        throw new BadRequestException(
          codes.tax.length === 0
            ? "Download KRA's lists first (Settings > eTIMS connection)."
            : 'KRA has no product classification with that code.',
        );
    }
    const pick = (
      value: string | null | undefined,
      set: Set<string>,
      what: string,
    ) => {
      if (value === undefined || value === null) return;
      if (set.size === 0)
        throw new BadRequestException(
          "Download KRA's lists first (Settings > eTIMS connection).",
        );
      if (!set.has(value))
        throw new BadRequestException(`KRA has no ${what} "${value}".`);
    };
    pick(dto.itemTyCd, codes.types, 'item type');
    pick(dto.pkgUnitCd, codes.packaging, 'packaging unit');
    pick(dto.qtyUnitCd, codes.units, 'unit of quantity');
    pick(dto.taxTyCd, new Set(codes.tax.map((t) => t.cd)), 'tax type');
  }

  private async upsertMapping(
    tx: TenantTx,
    organizationId: string,
    variantId: string,
    data: Prisma.EtimsItemUncheckedUpdateInput,
  ) {
    const existing = await tx.etimsItem.findUnique({ where: { variantId } });
    // fixing a rejected item lets it be sent again
    const reopen =
      existing?.status === 'REJECTED'
        ? { status: 'NOT_SENT' as const, lastError: null }
        : {};
    return tx.etimsItem.upsert({
      where: { variantId },
      create: {
        organizationId,
        variantId,
        ...(data as Prisma.EtimsItemUncheckedCreateInput),
      },
      update: { ...data, ...reopen },
    });
  }

  async update(variantId: string, dto: UpdateEtimsItemDto) {
    const { organizationId } = getTenantStore();
    await this.tenantPrisma.run(async (tx) => {
      if (!(await tx.productVariant.findUnique({ where: { id: variantId } })))
        throw new NotFoundException('Product not found');
      await this.validateChoices(tx, await this.environment(tx), dto);
      const data: Prisma.EtimsItemUncheckedUpdateInput = {};
      for (const k of [
        'itemClsCd',
        'itemTyCd',
        'pkgUnitCd',
        'qtyUnitCd',
      ] as const)
        if (dto[k] !== undefined) data[k] = dto[k];
      if (dto.taxTyCd !== undefined) data.taxTyCd = dto.taxTyCd; // null puts it back to "from the tax class"
      await this.upsertMapping(tx, organizationId, variantId, data);
      await this.auditLog.logInTx(tx, {
        action: 'etims.item_updated',
        entityType: 'ProductVariant',
        entityId: variantId,
        after: dto,
      });
    });
    return this.one(variantId);
  }

  /** Give the same KRA classification to many products at once (a whole shelf of the same kind). */
  async classify(variantIds: string[], itemClsCd: string) {
    const { organizationId } = getTenantStore();
    const ids = [...new Set(variantIds)];
    await this.tenantPrisma.run(async (tx) => {
      await this.validateChoices(tx, await this.environment(tx), { itemClsCd });
      const found = await tx.productVariant.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      if (found.length !== ids.length)
        throw new NotFoundException('One of those products was not found');
      for (const id of ids)
        await this.upsertMapping(tx, organizationId, id, { itemClsCd });
      await this.auditLog.logInTx(tx, {
        action: 'etims.items_classified',
        entityType: 'EtimsItem',
        entityId: itemClsCd,
        after: { count: ids.length, itemClsCd },
      });
    });
    return { updated: ids.length };
  }

  private async one(variantId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const v = await tx.productVariant.findUnique({
        where: { id: variantId },
        include: VARIANT_INCLUDE,
      });
      if (!v) throw new NotFoundException('Product not found');
      return this.rowView(
        v,
        this.describe(v, await this.codes(tx, await this.environment(tx))),
      );
    });
  }

  /**
   * Sends items to KRA, one at a time (the database is not held open while KRA answers). An item that is already registered and
   * unchanged is skipped. A rejection is kept with KRA's reason and does not stop the others; trouble reaching KRA, or a device KRA
   * no longer accepts, stops the round (the rest would fail the same way). At most REGISTER_BATCH go in one request.
   */
  async register(dto: { variantIds?: string[]; all?: boolean }) {
    const creds = await this.tenantPrisma.run((tx) =>
      this.settings.credentials(tx),
    );
    if (!creds)
      throw new BadRequestException(
        'Turn eTIMS on, enter the KRA PIN and connect a branch first.',
      );
    const { orgUserId } = getTenantStore();
    const registrant = await this.tenantPrisma.run(async (tx) => {
      const ou = await tx.orgUser.findUnique({
        where: { id: orgUserId },
        include: { user: { select: { fullName: true } } },
      });
      return { id: orgUserId, name: ou?.user.fullName ?? 'Staff' };
    });

    let ids = dto.variantIds ? [...new Set(dto.variantIds)] : [];
    if (dto.all) {
      ids = await this.tenantPrisma.run(async (tx) => {
        const codes = await this.codes(tx, creds.environment);
        return (await this.loadAll(tx))
          .map((v) => ({ id: v.id, state: this.describe(v, codes).state }))
          .filter((x) => x.state === 'READY' || x.state === 'NEEDS_UPDATE')
          .map((x) => x.id);
      });
    }
    if (ids.length === 0)
      return {
        sent: 0,
        skipped: 0,
        failed: [],
        remaining: 0,
        stopped: null as string | null,
      };
    const batch = ids.slice(0, REGISTER_BATCH);
    const result = {
      sent: 0,
      skipped: 0,
      failed: [] as { variantId: string; name: string; message: string }[],
      remaining: ids.length - batch.length,
      stopped: null as string | null,
    };

    for (const variantId of batch) {
      const prep = await this.tenantPrisma.run((tx) =>
        this.prepare(tx, variantId, creds.environment),
      );
      if (prep.kind === 'skip') {
        result.skipped += 1;
        continue;
      }
      if (prep.kind === 'problem') {
        result.failed.push({
          variantId,
          name: prep.name,
          message: prep.message,
        });
        continue;
      }
      const res = await this.client.call(
        creds.environment,
        'saveItem',
        buildSaveItemBody(creds, prep.fields, registrant),
      );
      const kind = classifyResult(res.resultCd);
      if (kind === 'OK' || kind === 'DUPLICATE' || kind === 'NO_DATA') {
        await this.tenantPrisma.run((tx) =>
          tx.etimsItem.update({
            where: { variantId },
            data: {
              status: 'REGISTERED',
              sentHash: prep.hash,
              lastError: null,
              registeredAt: new Date(),
            },
          }),
        );
        result.sent += 1;
      } else if (kind === 'FIX') {
        const message = explainResult(res.resultCd, res.resultMsg);
        await this.tenantPrisma.run((tx) =>
          tx.etimsItem.update({
            where: { variantId },
            data: { status: 'REJECTED', lastError: message.slice(0, 500) },
          }),
        );
        result.failed.push({ variantId, name: prep.fields.itemNm, message });
      } else {
        result.stopped = explainResult(res.resultCd, res.resultMsg);
        break;
      }
    }
    await this.tenantPrisma.run((tx) =>
      this.auditLog.logInTx(tx, {
        action: 'etims.items_registered',
        entityType: 'EtimsItem',
        entityId: creds.environment,
        after: {
          sent: result.sent,
          skipped: result.skipped,
          failed: result.failed.length,
          stopped: result.stopped,
        },
      }),
    );
    return result;
  }

  /** Works out what to send for one item, giving it its item code the first time. */
  private async prepare(
    tx: TenantTx,
    variantId: string,
    environment: EtimsEnvironment,
  ): Promise<
    | { kind: 'send'; fields: ItemFields; hash: string }
    | { kind: 'skip' }
    | { kind: 'problem'; name: string; message: string }
  > {
    const { organizationId } = getTenantStore();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'etims-item:' + variantId}))`;
    const v = await tx.productVariant.findUnique({
      where: { id: variantId },
      include: VARIANT_INCLUDE,
    });
    if (!v)
      return { kind: 'problem', name: variantId, message: 'Product not found' };
    const d = this.describe(v, await this.codes(tx, environment));
    if (d.state === 'REGISTERED') return { kind: 'skip' };
    if (d.state === 'NEEDS_SETUP' || !d.fieldsWithoutCode || !d.m)
      return {
        kind: 'problem',
        name: d.name,
        message: setupProblems({
          itemClsCd: d.m?.itemClsCd ?? null,
          taxProblem: d.taxProblem,
          name: d.name,
          price: d.price,
        }).join('. '),
      };
    let itemCd = d.m.itemCd;
    if (!itemCd) {
      const rows = await tx.$queryRaw<
        { itemSeq: number }[]
      >`UPDATE etims_settings SET "itemSeq" = "itemSeq" + 1 WHERE "organizationId" = ${organizationId} RETURNING "itemSeq"`;
      if (!rows[0]) throw new BadRequestException('Turn eTIMS on first.');
      itemCd = buildItemCode(
        rows[0].itemSeq,
        d.itemTyCd,
        d.pkgUnitCd,
        d.qtyUnitCd,
      );
      await tx.etimsItem.update({ where: { variantId }, data: { itemCd } });
    }
    return {
      kind: 'send',
      fields: { itemCd, ...d.fieldsWithoutCode },
      hash: d.currentHash!,
    };
  }
}
