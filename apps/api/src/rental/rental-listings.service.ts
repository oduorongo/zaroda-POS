import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, looksLikeImage } from '../catalog/product-images.service';
import { assertFeature } from './rental-plans.service';
import { SetListingActiveDto, UpsertListingDto } from './dto/rental-listing.dto';

export const MAX_LISTING_PHOTOS = 8;
/** An advert stays public this long after the landlord last confirmed it is still available (see rls.sql). */
export const LISTING_LIFETIME_DAYS = 30;

export const listingPhotoPrefix = (organizationId: string, listingId: string) => `orgs/${organizationId}/listings/${listingId}/`;

export type ListingState = 'LIVE' | 'PAUSED' | 'EXPIRED';
export function listingState(l: { isActive: boolean; confirmedAt: Date }, now = new Date()): ListingState {
  if (!l.isActive) return 'PAUSED';
  return l.confirmedAt.getTime() + LISTING_LIFETIME_DAYS * 86_400_000 > now.getTime() ? 'LIVE' : 'EXPIRED';
}

const INCLUDE = { photos: true, unit: { select: { label: true, property: { select: { name: true } } } } } as const;

/** Landlord-side management of "Houses to let" adverts. Public reading is in public-houses.service.ts. */
@Injectable()
export class RentalListingsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  private view(l: {
    id: string;
    unitId: string;
    title: string;
    unitType: string;
    area: string;
    monthlyRent: unknown;
    depositAmount: unknown;
    description: string | null;
    contactName: string | null;
    contactPhone: string;
    isActive: boolean;
    confirmedAt: Date;
    unit?: { label: string; property: { name: string } };
    photos: { id: string; storageKey: string; sortOrder: number }[];
  }) {
    return {
      id: l.id,
      unitId: l.unitId,
      unitLabel: l.unit?.label ?? null,
      propertyName: l.unit?.property.name ?? null,
      title: l.title,
      unitType: l.unitType,
      area: l.area,
      monthlyRent: Number(l.monthlyRent),
      depositAmount: Number(l.depositAmount),
      description: l.description,
      contactName: l.contactName,
      contactPhone: l.contactPhone,
      isActive: l.isActive,
      state: listingState(l),
      confirmedAt: l.confirmedAt,
      expiresAt: new Date(l.confirmedAt.getTime() + LISTING_LIFETIME_DAYS * 86_400_000),
      photos: [...l.photos]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({ id: p.id, url: this.storage.publicUrl(p.storageKey), sortOrder: p.sortOrder })),
    };
  }

  async list() {
    const rows = await this.tenantPrisma.run((tx) => tx.rentalListing.findMany({ include: INCLUDE, orderBy: { updatedAt: 'desc' } }));
    return rows.map((r) => this.view(r));
  }

  private async requireListing(tx: TenantTx, id: string) {
    const listing = await tx.rentalListing.findUnique({ where: { id }, include: INCLUDE });
    if (!listing) throw new NotFoundException('Advert not found');
    return listing;
  }

  /** Creates the unit's advert, or replaces its details; either way it goes live and the 30 days restart. */
  async upsertForUnit(unitId: string, dto: UpsertListingDto) {
    const { organizationId } = getTenantStore();
    const saved = await this.tenantPrisma.run(async (tx) => {
      await assertFeature(tx, organizationId, 'advertise');
      const unit = await tx.rentalUnit.findUnique({ where: { id: unitId } });
      if (!unit) throw new NotFoundException('Unit not found');
      if (unit.status !== 'VACANT') throw new ConflictException('Only an empty unit can be advertised.');
      const data = {
        title: dto.title,
        unitType: dto.unitType,
        area: dto.area,
        monthlyRent: dto.monthlyRent,
        depositAmount: dto.depositAmount,
        description: dto.description || null,
        contactName: dto.contactName || null,
        contactPhone: dto.contactPhone,
        isActive: true,
        confirmedAt: new Date(),
      };
      return tx.rentalListing.upsert({
        where: { unitId },
        create: { organizationId, unitId, ...data },
        update: data,
        include: INCLUDE,
      });
    });
    return this.view(saved);
  }

  /** "Still available": restarts the 30 days. */
  async confirm(id: string) {
    const { organizationId } = getTenantStore();
    const saved = await this.tenantPrisma.run(async (tx) => {
      await assertFeature(tx, organizationId, 'advertise');
      const listing = await this.requireListing(tx, id);
      if (!listing.isActive) throw new ConflictException('This advert is paused. Resume it instead.');
      return tx.rentalListing.update({ where: { id }, data: { confirmedAt: new Date() }, include: INCLUDE });
    });
    return this.view(saved);
  }

  async setActive(id: string, dto: SetListingActiveDto) {
    const { organizationId } = getTenantStore();
    const saved = await this.tenantPrisma.run(async (tx) => {
      const listing = await this.requireListing(tx, id);
      if (dto.isActive) {
        await assertFeature(tx, organizationId, 'advertise');
        const unit = await tx.rentalUnit.findUnique({ where: { id: listing.unitId } });
        if (unit?.status !== 'VACANT') throw new ConflictException('Only an empty unit can be advertised.');
      }
      return tx.rentalListing.update({
        where: { id },
        data: { isActive: dto.isActive, ...(dto.isActive ? { confirmedAt: new Date() } : {}) },
        include: INCLUDE,
      });
    });
    return this.view(saved);
  }

  async remove(id: string) {
    const keys = await this.tenantPrisma.run(async (tx) => {
      const listing = await this.requireListing(tx, id);
      await tx.rentalListing.delete({ where: { id } });
      return listing.photos.map((p) => p.storageKey);
    });
    await this.storage.deleteMany(keys);
  }

  async addPhoto(id: string, contentType: string, body: Buffer) {
    const { organizationId } = getTenantStore();
    const extension = IMAGE_CONTENT_TYPES[contentType];
    if (!extension) throw new BadRequestException('Photos must be JPEG, PNG or WebP');
    if (body.length === 0) throw new BadRequestException('The photo is empty');
    if (body.length > MAX_IMAGE_BYTES) throw new BadRequestException('Photos must be 5MB or smaller');
    if (!looksLikeImage(contentType, body)) throw new BadRequestException('That file is not a valid JPEG, PNG or WebP photo');

    await this.tenantPrisma.run(async (tx) => {
      await this.requireListing(tx, id);
      if ((await tx.rentalListingPhoto.count({ where: { listingId: id } })) >= MAX_LISTING_PHOTOS) {
        throw new BadRequestException(`An advert can have at most ${MAX_LISTING_PHOTOS} photos`);
      }
    });

    const key = `${listingPhotoPrefix(organizationId, id)}${randomUUID()}.${extension}`;
    await this.storage.upload(key, body, contentType);
    try {
      const photo = await this.tenantPrisma.run(async (tx) => {
        await this.requireListing(tx, id);
        const existing = await tx.rentalListingPhoto.findMany({ where: { listingId: id }, select: { sortOrder: true } });
        if (existing.length >= MAX_LISTING_PHOTOS) {
          throw new BadRequestException(`An advert can have at most ${MAX_LISTING_PHOTOS} photos`);
        }
        const next = existing.reduce((max, p) => Math.max(max, p.sortOrder + 1), 0);
        return tx.rentalListingPhoto.create({ data: { listingId: id, storageKey: key, sortOrder: next } });
      });
      return { id: photo.id, url: this.storage.publicUrl(photo.storageKey), sortOrder: photo.sortOrder };
    } catch (e) {
      await this.storage.deleteMany([key]);
      throw e;
    }
  }

  async makeCover(id: string, photoId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.requireListing(tx, id);
      const photos = await tx.rentalListingPhoto.findMany({ where: { listingId: id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
      const target = photos.find((p) => p.id === photoId);
      if (!target) throw new NotFoundException('Photo not found');
      const ordered = [target, ...photos.filter((p) => p.id !== photoId)];
      for (const [index, photo] of ordered.entries()) {
        if (photo.sortOrder !== index) await tx.rentalListingPhoto.update({ where: { id: photo.id }, data: { sortOrder: index } });
      }
      return ordered.map((p, index) => ({ id: p.id, url: this.storage.publicUrl(p.storageKey), sortOrder: index }));
    });
  }

  async removePhoto(id: string, photoId: string) {
    const photo = await this.tenantPrisma.run(async (tx) => {
      await this.requireListing(tx, id);
      const found = await tx.rentalListingPhoto.findFirst({ where: { id: photoId, listingId: id } });
      if (!found) throw new NotFoundException('Photo not found');
      await tx.rentalListingPhoto.delete({ where: { id: photoId } });
      return found;
    });
    await this.storage.deleteMany([photo.storageKey]);
  }
}
