import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { ConfirmProductImageDto, RequestProductImageUploadDto } from './dto/product-image.dto';

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

/**
 * Two-step upload: requestUpload hands the browser a presigned URL to PUT
 * the file straight to the bucket, then confirm checks the file actually
 * landed (right place, type and size) before recording it. Nothing is
 * written to the database until confirm, so an abandoned upload leaves at
 * most an unreferenced file, never a broken image row.
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

  async requestUpload(productId: string, dto: RequestProductImageUploadDto) {
    const { organizationId } = getTenantStore();
    const extension = IMAGE_CONTENT_TYPES[dto.contentType];
    if (!extension) throw new BadRequestException('Photos must be JPEG, PNG or WebP');
    if (dto.sizeBytes > MAX_IMAGE_BYTES) throw new BadRequestException('Photos must be 5MB or smaller');

    await this.tenantPrisma.run(async (tx) => {
      await this.requireProduct(tx, productId);
      const count = await tx.productImage.count({ where: { productId } });
      if (count >= MAX_IMAGES_PER_PRODUCT) {
        throw new BadRequestException(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} photos`);
      }
    });

    const key = `${productImagePrefix(organizationId, productId)}${randomUUID()}.${extension}`;
    const uploadUrl = await this.storage.createUploadUrl(key, dto.contentType, dto.sizeBytes);
    return { uploadUrl, key };
  }

  async confirm(productId: string, dto: ConfirmProductImageDto) {
    const { organizationId } = getTenantStore();
    const prefix = productImagePrefix(organizationId, productId);
    const fileName = dto.key.slice(prefix.length);
    if (!dto.key.startsWith(prefix) || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(fileName)) {
      throw new BadRequestException('Invalid upload key');
    }

    // Checked against what's actually in the bucket, not what the browser
    // claims - the presigned URL already pins type and size, this is the
    // second line of defence.
    const object = await this.storage.head(dto.key);
    if (!object) throw new BadRequestException('Upload not found - try uploading the photo again');
    if (object.sizeBytes > MAX_IMAGE_BYTES || !object.contentType || !IMAGE_CONTENT_TYPES[object.contentType]) {
      await this.storage.deleteMany([dto.key]);
      throw new BadRequestException('Photos must be JPEG, PNG or WebP, 5MB or smaller');
    }

    const image = await this.tenantPrisma.run(async (tx) => {
      await this.requireProduct(tx, productId);
      const existing = await tx.productImage.findMany({ where: { productId }, select: { sortOrder: true } });
      if (existing.length >= MAX_IMAGES_PER_PRODUCT) {
        throw new BadRequestException(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} photos`);
      }
      const nextOrder = existing.reduce((max, i) => Math.max(max, i.sortOrder + 1), 0);
      return tx.productImage.upsert({
        // Idempotent: confirming the same upload twice (a retried request)
        // returns the existing row instead of erroring on the unique key.
        where: { storageKey: dto.key },
        create: { productId, storageKey: dto.key, sortOrder: nextOrder },
        update: {},
      });
    });
    return this.toView(image);
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
