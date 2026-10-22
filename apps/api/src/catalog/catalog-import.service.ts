import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  ExistingCatalog,
  PlannedVariant,
  rowLimitProblem,
  validateImport,
} from './catalog-import.util';
import { ImportProductsDto } from './dto/catalog-import.dto';

/**
 * Bulk product import. Always checks the whole file first (the same checks for the preview and the real thing) and returns every
 * problem with its row number. The real import then writes everything in ONE transaction: all of it or nothing. Opening stock is
 * recorded as proper inventory movements (never a silent overwrite of a stock figure).
 */
@Injectable()
export class CatalogImportService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async loadExisting(tx: TenantTx): Promise<ExistingCatalog> {
    const [variants, taxClasses, categories, products] = await Promise.all([
      tx.productVariant.findMany({ select: { sku: true, barcode: true } }),
      tx.taxClass.findMany({ select: { id: true, name: true } }),
      tx.category.findMany({ select: { id: true, name: true } }),
      tx.product.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      skus: new Set(variants.map((v) => v.sku.toLowerCase())),
      barcodes: new Set(
        variants.filter((v) => v.barcode).map((v) => v.barcode!.toLowerCase()),
      ),
      taxClasses: new Map(taxClasses.map((t) => [t.name.toLowerCase(), t.id])),
      categories: new Map(categories.map((c) => [c.name.toLowerCase(), c.id])),
      products: new Map(products.map((p) => [p.name.toLowerCase(), p.id])),
    };
  }

  async run(dto: ImportProductsDto) {
    const tooMany = rowLimitProblem(dto.rows.length);
    if (tooMany) throw new BadRequestException(tooMany);
    const dryRun = dto.dryRun !== false; // a request that does not say so is a preview, never a surprise import

    return this.tenantPrisma
      .run(async (tx) => {
        if (
          dto.branchId &&
          !(await tx.branch.findUnique({ where: { id: dto.branchId } }))
        )
          throw new NotFoundException('Branch not found');
        const existing = await this.loadExisting(tx);
        const { errors, variants, summary } = validateImport(
          dto.rows,
          existing,
          Boolean(dto.branchId),
        );

        if (dryRun)
          return { dryRun: true, ok: errors.length === 0, errors, summary };
        if (errors.length > 0) {
          throw new BadRequestException({
            message: `${errors.length} problem${errors.length === 1 ? '' : 's'} in the file. Nothing was imported.`,
            errors,
            summary,
          });
        }

        const created = await this.write(tx, variants, existing, dto.branchId);
        await this.auditLog.logInTx(tx, {
          action: 'catalog.import',
          entityType: 'Catalog',
          entityId: created.importId,
          after: { ...created, rows: dto.rows.length },
        });
        return { dryRun: false, ok: true, errors: [], summary, created };
      })
      .catch((e) => {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException(
            'Something in the file was added by someone else while it was being imported. Nothing was imported - check the file again.',
          );
        }
        throw e;
      });
  }

  private async write(
    tx: TenantTx,
    variants: PlannedVariant[],
    existing: ExistingCatalog,
    branchId: string | undefined,
  ) {
    const { organizationId } = getTenantStore();
    const importId = randomUUID();

    // categories that are not there yet (spelling from the file's first use)
    const categoryIds = new Map(existing.categories);
    const newCategories: {
      id: string;
      organizationId: string;
      name: string;
    }[] = [];
    for (const v of variants) {
      if (!v.category || existing.products.has(v.productKey)) continue;
      const key = v.category.toLowerCase();
      if (categoryIds.has(key)) continue;
      const id = randomUUID();
      categoryIds.set(key, id);
      newCategories.push({ id, organizationId, name: v.category });
    }
    if (newCategories.length > 0)
      await tx.category.createMany({ data: newCategories });

    // products: new ones are made once (from their first row); options of an existing product join it
    const productIds = new Map(existing.products);
    const newProducts: Prisma.ProductCreateManyInput[] = [];
    for (const v of variants) {
      if (productIds.has(v.productKey)) continue;
      const id = randomUUID();
      productIds.set(v.productKey, id);
      newProducts.push({
        id,
        organizationId,
        name: v.productName,
        categoryId: v.category
          ? categoryIds.get(v.category.toLowerCase())
          : undefined,
        taxClassId: v.taxClassId ?? undefined,
      });
    }
    if (newProducts.length > 0)
      await tx.product.createMany({ data: newProducts });

    const variantRows = variants.map((v) => ({ id: randomUUID(), planned: v }));
    await tx.productVariant.createMany({
      data: variantRows.map(({ id, planned: v }) => ({
        id,
        productId: productIds.get(v.productKey)!,
        sku: v.sku,
        name: v.variantName ?? undefined,
        price: v.price,
        cost: v.cost ?? undefined,
        barcode: v.barcode ?? undefined,
        quantityMode: v.quantityMode,
      })),
    });

    // opening stock: a movement for each, and the stock figure that follows from it (these options are brand new, so none exists yet)
    const withStock = variantRows.filter(
      (r) => r.planned.openingStock !== null,
    );
    if (withStock.length > 0 && branchId) {
      await tx.inventoryTransaction.createMany({
        data: withStock.map((r) => ({
          branchId,
          variantId: r.id,
          type: InventoryTxnType.ADJUSTMENT,
          quantityDelta: r.planned.openingStock!,
          unitCost: r.planned.cost ?? undefined,
          referenceId: importId,
        })),
      });
      await tx.inventoryItem.createMany({
        data: withStock.map((r) => ({
          branchId,
          variantId: r.id,
          quantity: r.planned.openingStock!,
        })),
      });
    }
    return {
      importId,
      categories: newCategories.length,
      products: newProducts.length,
      variants: variantRows.length,
      stockRows: withStock.length,
    };
  }
}
