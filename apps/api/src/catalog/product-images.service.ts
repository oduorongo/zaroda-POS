import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ObjectStorageService } from '../common/storage/object-storage.service';

export const MAX_IMAGES_PER_PRODUCT = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Every key for a product's photos lives under this prefix - see ProductImage.storageKey's schema comment. */
export function productImagePrefix(organizationId: string, productId: string): string {
  return `orgs/${organizationId}/products/${productId}/`;
}

/** True if the bytes really are the image type claimed - a renamed .exe or HTML file is refused. */
export function looksLikeImage(contentType: string, b: Buffer): boolean {
  if (contentType === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (contentType === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === 'image/webp') return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

/**
 * The browser sends the photo to the API, which checks it (type claimed,
 * real file contents, size, photo count) and only then stores it and records
 * it. Photos are capped at 5MB so passing them through the API is cheap, and
 * it means nothing unchecked ever reaches the store. If recording fails after
 * the store accepted the file, the file is removed again.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  private async requireProduct(tx: TenantTx, productId: string) {
    // RLS-scoped - another tenant's product id simply isn't found.
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private toView(image: { id: string; storageKey: string; sortOrder: number }) {
    return { id: image.id, url: this.storage.publicUrl(image.storageKey), sortOrder: image.sortOrder };
  }

  async list(productId: string) {
    const images = await this.tenantPrisma.run(async (tx) => {
      await this.requireProduct(tx, productId);
      return tx.productImage.findMany({ where: { productId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    });
    return images.map((image) => this.toView(image));
  }

  async upload(productId: string, contentType: string, body: Buffer) {
    const { organizationId } = getTenantStore();
    const extension = IMAGE_CONTENT_TYPES[contentType];
    if (!extension) throw new BadRequestException('Photos must be JPEG, PNG or WebP');
    if (body.length === 0) throw new BadRequestException('The photo is empty');
    if (body.length > MAX_IMAGE_BYTES) throw new BadRequestException('Photos must be 5MB or smaller');
    if (!looksLikeImage(contentType, body)) throw new BadRequestException('That file is not a valid JPEG, PNG or WebP photo');

    await this.tenantPrisma.run(async (tx) => {
      await this.requireProduct(tx, productId);
      const count = await tx.productImage.count({ where: { productId } });
      if (count >= MAX_IMAGES_PER_PRODUCT) {
        throw new BadRequestException(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} photos`);
      }
    });

    const key = `${productImagePrefix(organizationId, productId)}${randomUUID()}.${extension}`;
    await this.storage.upload(key, body, contentType);

    try {
      const image = await this.tenantPrisma.run(async (tx) => {
        await this.requireProduct(tx, productId);
        const existing = await tx.productImage.findMany({ where: { productId }, select: { sortOrder: true } });
        if (existing.length >= MAX_IMAGES_PER_PRODUCT) {
          throw new BadRequestException(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} photos`);
        }
        const nextOrder = existing.reduce((max, i) => Math.max(max, i.sortOrder + 1), 0);
        return tx.productImage.create({ data: { productId, storageKey: key, sortOrder: nextOrder } });
      });
      return this.toView(image);
    } catch (e) {
      await this.storage.deleteMany([key]);
      throw e;
    }
  }

  /** Moves one photo to the front (the cover shown in the shop), keeping the others in their current order. */
  async makeCover(productId: string, imageId: string) {
    const images = await this.tenantPrisma.run(async (tx) => {
      await this.requireProduct(tx, productId);
      const current = await tx.productImage.findMany({
        where: { productId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const target = current.find((i) => i.id === imageId);
      if (!target) throw new NotFoundException('Photo not found');
      const reordered = [target, ...current.filter((i) => i.id !== imageId)];
      for (const [index, image] of reordered.entries()) {
        if (image.sortOrder !== index) {
          await tx.productImage.update({ where: { id: image.id }, data: { sortOrder: index } });
        }
      }
      return reordered.map((image, index) => ({ ...image, sortOrder: index }));
    });
    return images.map((image) => this.toView(image));
  }

  async remove(productId: string, imageId: string) {
    const removed = await this.tenantPrisma.run(async (tx) => {
      await this.requireProduct(tx, productId);
      const image = await tx.productImage.findFirst({ where: { id: imageId, productId } });
      if (!image) throw new NotFoundException('Photo not found');
      await tx.productImage.delete({ where: { id: imageId } });
      return image;
    });
    await this.storage.deleteMany([removed.storageKey]);
  }

  /** Storage keys to clean up after a product is deleted (its rows cascade away with it). */
  async keysForProduct(tx: TenantTx, productId: string): Promise<string[]> {
    const images = await tx.productImage.findMany({ where: { productId }, select: { storageKey: true } });
    return images.map((i) => i.storageKey);
  }
}
