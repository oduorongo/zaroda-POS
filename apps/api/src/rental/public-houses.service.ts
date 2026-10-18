import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { LISTING_UNIT_TYPES } from './dto/rental-listing.dto';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
export const HOUSES_PAGE_SIZE = 24;

export interface HouseFilters {
  area?: string;
  type?: string;
  minRent?: number;
  maxRent?: number;
  page?: number;
}

/**
 * Reads "Houses to let" adverts for unauthenticated visitors. Each query opts in to the narrow
 * public_listings_read policy (rls.sql), which only ever shows adverts that are switched on and were confirmed
 * within the last 30 days - and the advert holds its own area, rent and contact details, so nothing about the
 * landlord's units, properties or tenants is reachable from here.
 */
@Injectable()
export class PublicHousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  private publicRead<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_listings', 'on', true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  async list(filters: HouseFilters) {
    const page = Math.max(0, Math.floor(filters.page ?? 0));
    const where: Prisma.RentalListingWhereInput = {};
    const area = filters.area?.trim().slice(0, 80);
    if (area) where.area = { contains: area, mode: 'insensitive' };
    if (filters.type && (LISTING_UNIT_TYPES as readonly string[]).includes(filters.type)) where.unitType = filters.type;
    const rent: Prisma.DecimalFilter = {};
    if (Number.isFinite(filters.minRent)) rent.gte = filters.minRent as number;
    if (Number.isFinite(filters.maxRent)) rent.lte = filters.maxRent as number;
    if (Object.keys(rent).length) where.monthlyRent = rent;

    const rows = await this.publicRead((tx) =>
      tx.rentalListing.findMany({
        where,
        orderBy: { confirmedAt: 'desc' },
        skip: page * HOUSES_PAGE_SIZE,
        take: HOUSES_PAGE_SIZE + 1,
        select: {
          id: true,
          title: true,
          unitType: true,
          area: true,
          monthlyRent: true,
          depositAmount: true,
          confirmedAt: true,
          photos: { orderBy: { sortOrder: 'asc' }, select: { storageKey: true } },
        },
      }),
    );
    const hasMore = rows.length > HOUSES_PAGE_SIZE;
    return {
      hasMore,
      houses: rows.slice(0, HOUSES_PAGE_SIZE).map((r) => ({
        id: r.id,
        title: r.title,
        unitType: r.unitType,
        area: r.area,
        monthlyRent: Number(r.monthlyRent),
        depositAmount: Number(r.depositAmount),
        postedAt: r.confirmedAt,
        coverImage: r.photos[0] ? this.storage.publicUrl(r.photos[0].storageKey) : null,
        photoCount: r.photos.length,
      })),
    };
  }

  async get(id: string) {
    const row = await this.publicRead((tx) =>
      tx.rentalListing.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          unitType: true,
          area: true,
          monthlyRent: true,
          depositAmount: true,
          description: true,
          contactName: true,
          contactPhone: true,
          confirmedAt: true,
          photos: { orderBy: { sortOrder: 'asc' }, select: { storageKey: true } },
        },
      }),
    );
    // The policy already hides paused and expired adverts, so "not found" covers them too.
    if (!row) throw new NotFoundException('This house is no longer available');
    return {
      id: row.id,
      title: row.title,
      unitType: row.unitType,
      area: row.area,
      monthlyRent: Number(row.monthlyRent),
      depositAmount: Number(row.depositAmount),
      description: row.description,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      postedAt: row.confirmedAt,
      images: row.photos.map((p) => this.storage.publicUrl(p.storageKey)),
    };
  }
}
