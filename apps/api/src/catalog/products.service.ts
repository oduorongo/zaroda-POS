import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductImagesService } from './product-images.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly images: ProductImagesService,
    private readonly storage: ObjectStorageService,
  ) {}

  create(dto: CreateProductDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.product.create({ data: { ...dto, organizationId } }),
    );
  }

  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.product.findMany({
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
    return this.tenantPrisma.run((tx) =>
      tx.product.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string) {
    await this.findOne(id);
    // Photo rows cascade away with the product; their files in the bucket
    // don't, so collect the keys first and delete the files afterwards.
    const imageKeys = await this.tenantPrisma.run(async (tx) => {
      const keys = await this.images.keysForProduct(tx, id);
      await tx.product.delete({ where: { id } });
      return keys;
    });
    await this.storage.deleteMany(imageKeys);
  }
}
