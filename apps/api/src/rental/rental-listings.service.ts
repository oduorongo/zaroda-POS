import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, looksLikeImage } from '../catalog/product-images.service';
import { LISTING_DAYS, LISTING_FEE_KES, ListingState, listingState } from './rental-listing-fee.util';
import { SetListingActiveDto, UpsertListingDto } from './dto/rental-listing.dto';

export const MAX_LISTING_PHOTOS = 8;
export const listingPhotoPrefix = (organizationId: string, listingId: string) => `orgs/${organizationId}/listings/${listingId}/`;

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
    paidUntil: Date | null;
    blockedAt?: Date | null;
    blockedReason?: string | null;
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
      state: listingState(l) as ListingState,
      paidUntil: l.paidUntil,
      blockedReason: l.blockedAt ? (l.blockedReason ?? 'Taken down by Zaroda') : null,
      feeKes: LISTING_FEE_KES,
      days: LISTING_DAYS,
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

  /** Creates the unit's advert, or edits its details. Editing never changes whether it is on or how long it is paid for. */
  async upsertForUnit(unitId: string, dto: UpsertListingDto) {
    const { organizationId } = getTenantStore();
    const saved = await this.tenantPrisma.run(async (tx) => {
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
      };
      return tx.rentalListing.upsert({
        where: { unitId },
        // A new advert starts switched on but unpaid (not public); paying is what makes it live.
        create: { organizationId, unitId, ...data, isActive: true },
        update: data,
        include: INCLUDE,
      });
    });
    return this.view(saved);
  }

  async setActive(id: string, dto: SetListingActiveDto) {
    const saved = await this.tenantPrisma.run(async (tx) => {
      const listing = await this.requireListing(tx, id);
      if (dto.isActive) {
        if (listing.blockedAt) throw new ConflictException(`Zaroda has taken this advert down: ${listing.blockedReason ?? 'please contact Zaroda'}`);
        const unit = await tx.rentalUnit.findUnique({ where: { id: listing.unitId } });
        if (unit?.status !== 'VACANT') throw new ConflictException('Only an empty unit can be advertised.');
      }
      return tx.rentalListing.update({
        where: { id },
        data: { isActive: dto.isActive },
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
