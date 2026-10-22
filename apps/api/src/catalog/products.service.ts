import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductImagesService } from './product-images.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { deleteDecision, HISTORY_SOURCES } from './product-archive.util';

@Injectable()
export class ProductsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly images: ProductImagesService,
    private readonly storage: ObjectStorageService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** A category or tax class named by the client must really be this business's (the database hides everyone else's). */
  private async assertRefsExist(
    tx: TenantTx,
    refs: { categoryId?: string | null; taxClassId?: string | null },
  ) {
    if (
      refs.categoryId &&
      !(await tx.category.findUnique({ where: { id: refs.categoryId } }))
    ) {
      throw new BadRequestException('That category does not exist');
    }
    if (
      refs.taxClassId &&
      !(await tx.taxClass.findUnique({ where: { id: refs.taxClassId } }))
    ) {
      throw new BadRequestException('That tax class does not exist');
    }
  }

  create(dto: CreateProductDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await this.assertRefsExist(tx, dto);
      return tx.product.create({ data: { ...dto, organizationId } });
    });
  }

  /** The catalog. Archived products are left out unless asked for (the till, the menus and the shop never show them). */
  findAll(options: { includeArchived?: boolean } = {}) {
    return this.tenantPrisma.run((tx) =>
      tx.product.findMany({
        where: options.includeArchived ? undefined : { isActive: true },
        orderBy: { name: 'asc' },
        // taxClass included (not just categorized) because the terminal
        // PWA caches this response to compute an offline sale's total
        // before it's ever synced - it needs to show the cashier an
        // accurate figure to collect cash for right now, not just after
        // the server recomputes it at sync time.
        include: { variants: true, category: true, taxClass: true },
      }),
    );
  }

  async findOne(id: string) {
    const product = await this.tenantPrisma.run((tx) =>
      tx.product.findUnique({
        where: { id },
        // taxClass included (not just categorized) because the terminal
        // PWA caches this response to compute an offline sale's total
        // before it's ever synced - it needs to show the cashier an
        // accurate figure to collect cash for right now, not just after
        // the server recomputes it at sync time.
        include: { variants: true, category: true, taxClass: true },
      }),
    );
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    return this.tenantPrisma.run(async (tx) => {
      await this.assertRefsExist(tx, dto);
      return tx.product.update({ where: { id }, data: dto });
    });
  }

  private async countHistory(
    tx: TenantTx,
    variantIds: string[],
  ): Promise<number[]> {
    if (variantIds.length === 0) return [];
    const counts: number[] = [];
    for (const source of HISTORY_SOURCES) {
      // the delegates are looked up by name (one list of where a product can turn up - see product-archive.util.ts)
      const delegate = (
        tx as unknown as Record<
          string,
          { count: (args: unknown) => Promise<number> }
        >
      )[source.delegate];
      const n = await delegate.count({
        where: { [source.field]: { in: variantIds } },
      });
      counts.push(n);
      if (n > 0) break; // one is enough to know
    }
    return counts;
  }

  private async archiveInTx(tx: TenantTx, id: string, name: string) {
    await tx.product.update({
      where: { id },
      data: { isActive: false, archivedAt: new Date(), onlineVisible: false },
    });
    await this.auditLog.logInTx(tx, {
      action: 'catalog.product_archived',
      entityType: 'Product',
      entityId: id,
      before: { name },
    });
  }

  /**
   * Removes a product: one that appears anywhere in the business's history (sales, stock movements, purchase orders, recipes,
   * online orders...) is ARCHIVED - hidden from the till, menus and shop but kept for reports - and one that never has is
   * deleted. The answer says which.
   */
  async remove(id: string): Promise<{ archived: boolean }> {
    try {
      const outcome = await this.tenantPrisma.run(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id },
          include: { variants: { select: { id: true } } },
        });
        if (!product) throw new NotFoundException('Product not found');
        const decision = deleteDecision(
          await this.countHistory(
            tx,
            product.variants.map((v) => v.id),
          ),
        );
        if (decision === 'ARCHIVE') {
          await this.archiveInTx(tx, id, product.name);
          return { archived: true, keys: [] as string[] };
        }
        // Photo rows cascade away with the product; their files in the bucket
        // don't, so collect the keys first and delete the files afterwards.
        const keys = await this.images.keysForProduct(tx, id);
        await tx.product.delete({ where: { id } });
        await this.auditLog.logInTx(tx, {
          action: 'catalog.product_deleted',
          entityType: 'Product',
          entityId: id,
          before: { name: product.name },
        });
        return { archived: false, keys };
      });
      await this.storage.deleteMany(outcome.keys);
      return { archived: outcome.archived };
    } catch (e) {
      // Something still points at it that the list above does not know about: archive rather than fail.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        await this.tenantPrisma.run(async (tx) => {
          const product = await tx.product.findUnique({ where: { id } });
          if (product) await this.archiveInTx(tx, id, product.name);
        });
        return { archived: true };
      }
      throw e;
    }
  }

  /** Brings an archived product back. It stays off the online shop until it is switched on there again. */
  async restore(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const product = await tx.product.findUnique({ where: { id } });
      if (!product) throw new NotFoundException('Product not found');
      if (product.isActive) return product;
      const restored = await tx.product.update({
        where: { id },
        data: { isActive: true, archivedAt: null },
      });
      await this.auditLog.logInTx(tx, {
        action: 'catalog.product_restored',
        entityType: 'Product',
        entityId: id,
        after: { name: product.name },
      });
      return restored;
    });
  }
}
