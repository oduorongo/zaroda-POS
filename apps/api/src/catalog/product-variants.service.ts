import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
} from './dto/product-variant.dto';
import { generateInternalEan13, normalizeBarcode } from './barcode.util';
import { variantTitle } from './variant-title';

/** A typed option name tidied up; blank means none. */
const cleanName = (name: string | undefined) => name?.trim() || null;

/** A typed barcode made usable, or a plain 400 saying what is wrong with it. */
function tidyBarcode(input: string | undefined): string | null | undefined {
  if (input === undefined) return undefined; // not being changed
  try {
    return normalizeBarcode(input);
  } catch (e) {
    throw new BadRequestException(e instanceof Error ? e.message : 'That is not a usable barcode');
  }
}

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

  /**
   * A barcode must belong to ONE option: a scan has to find exactly one thing. Also refused when it equals another option's
   * product code, because the till matches a scan against both.
   */
  private async assertBarcodeFree(tx: TenantTx, barcode: string, exceptVariantId?: string) {
    const clash = await tx.productVariant.findFirst({
      where: {
        id: exceptVariantId ? { not: exceptVariantId } : undefined,
        OR: [{ barcode: { equals: barcode, mode: 'insensitive' } }, { sku: { equals: barcode, mode: 'insensitive' } }],
      },
      include: { product: { select: { name: true } } },
    });
    if (clash) {
      throw new ConflictException(`That barcode is already used by ${variantTitle(clash.product.name, clash.name)} (${clash.sku}). A barcode can belong to only one product.`);
    }
  }

  /** A product code that is already another option's barcode would make a scan find two things. */
  private async assertCodeIsNotABarcode(tx: TenantTx, sku: string, exceptVariantId?: string) {
    const clash = await tx.productVariant.findFirst({
      where: { id: exceptVariantId ? { not: exceptVariantId } : undefined, barcode: { equals: sku.trim(), mode: 'insensitive' } },
      include: { product: { select: { name: true } } },
    });
    if (clash) {
      throw new ConflictException(`That product code is already the barcode of ${variantTitle(clash.product.name, clash.name)} (${clash.sku}). Choose a different code.`);
    }
  }

  async create(productId: string, dto: CreateProductVariantDto) {
    const barcode = tidyBarcode(dto.barcode);
    return this.tenantPrisma.run(async (tx) => {
      await this.assertProductExists(productId, tx);
      await this.assertCodeIsNotABarcode(tx, dto.sku);
      if (barcode) await this.assertBarcodeFree(tx, barcode);
      return tx.productVariant.create({ data: { ...dto, name: cleanName(dto.name), barcode, productId } });
    });
  }

  /**
   * Gives an option a barcode of the shop's own (an in-store EAN-13) if it has none, and returns it - the same one every time
   * after that. For things nobody printed a barcode on: bread, a repacked bag, a plate of food.
   */
  async generateBarcode(productId: string, variantId: string) {
    await this.findOne(productId, variantId);
    return this.tenantPrisma.run((tx) => this.ensureBarcode(tx, variantId));
  }

  /** The same for many options at once (the label printer's "make barcodes for these"). Missing ones only; the rest are left alone. */
  async generateBarcodes(variantIds: string[]) {
    return this.tenantPrisma.run(async (tx) => {
      const done = [];
      for (const id of Array.from(new Set(variantIds))) done.push(await this.ensureBarcode(tx, id));
      return done;
    });
  }

  private async ensureBarcode(tx: TenantTx, variantId: string) {
    const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundException('Product variant not found');
    if (variant.barcode) return variant;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateInternalEan13();
      const taken = await tx.productVariant.findFirst({ where: { OR: [{ barcode: code }, { sku: code }] }, select: { id: true } });
      if (!taken) return tx.productVariant.update({ where: { id: variantId }, data: { barcode: code } });
    }
    throw new ConflictException('Could not make a free barcode - please try again');
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
    const barcode = tidyBarcode(dto.barcode);
    return this.tenantPrisma.run(async (tx) => {
      if (dto.sku) await this.assertCodeIsNotABarcode(tx, dto.sku, variantId);
      if (barcode) await this.assertBarcodeFree(tx, barcode, variantId);
      return tx.productVariant.update({ where: { id: variantId }, data: { ...dto, barcode, name: dto.name === undefined ? undefined : cleanName(dto.name) } });
    });
  }

  async remove(productId: string, variantId: string) {
    await this.findOne(productId, variantId);
    await this.tenantPrisma.run((tx) =>
      tx.productVariant.delete({ where: { id: variantId } }),
    );
  }
}
