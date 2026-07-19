import { Injectable, NotFoundException } from '@nestjs/common';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
} from './dto/product-variant.dto';

@Injectable()
export class ProductVariantsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /**
   * Confirms the product exists (and is this tenant's) before touching a
   * variant under it - RLS would reject a cross-tenant productId anyway
   * (product_variants' policy is an EXISTS through products), but as a raw
   * policy violation rather than a clean 404, so check explicitly instead.
   */
  private async assertProductExists(productId: string, tx: TenantTx) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
  }

  create(productId: string, dto: CreateProductVariantDto) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertProductExists(productId, tx);
      return tx.productVariant.create({ data: { ...dto, productId } });
    });
  }

  findAll(productId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertProductExists(productId, tx);
      return tx.productVariant.findMany({
        where: { productId },
        orderBy: { sku: 'asc' },
      });
    });
  }

  async findOne(productId: string, variantId: string) {
    const variant = await this.tenantPrisma.run((tx) =>
      tx.productVariant.findFirst({ where: { id: variantId, productId } }),
    );
    if (!variant) throw new NotFoundException('Product variant not found');
    return variant;
  }

  async update(
    productId: string,
    variantId: string,
    dto: UpdateProductVariantDto,
  ) {
    await this.findOne(productId, variantId);
    return this.tenantPrisma.run((tx) =>
      tx.productVariant.update({ where: { id: variantId }, data: dto }),
    );
  }

  async remove(productId: string, variantId: string) {
    await this.findOne(productId, variantId);
    await this.tenantPrisma.run((tx) =>
      tx.productVariant.delete({ where: { id: variantId } }),
    );
  }
}
