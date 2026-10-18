import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { LISTING_FEE_KES, listingState } from './rental-listing-fee.util';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 };

/**
 * The platform owner's view of every "Houses to let" advert across all landlords: what is live, what is waiting for
 * payment, what has been paid, and a way to take an advert down (and put it back). Each landlord's rows are read inside
 * that landlord's own tenant context, the same way the rental invoice list is.
 */
@Injectable()
export class RentalListingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  private runAsTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  async list() {
    const organizations = await this.prisma.organization.findMany({
      where: { industryType: 'RENTAL' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const now = new Date();
    const rows = [];
    for (const org of organizations) {
      const { listings, payments } = await this.runAsTenant(org.id, async (tx) => ({
        listings: await tx.rentalListing.findMany({
          include: { photos: { orderBy: { sortOrder: 'asc' } }, unit: { select: { label: true, property: { select: { name: true } } } } },
        }),
        payments: await tx.rentalListingPayment.findMany({ where: { status: 'PAID' }, select: { amount: true, listingIds: true, listingId: true } }),
      }));
      for (const l of listings) {
        // A payment for several adverts is split evenly: KES 100 each, which is exactly what each one was charged.
        const mine = payments.filter((p) => (p.listingIds.length > 0 ? p.listingIds : [p.listingId]).includes(l.id));
        rows.push({
          id: l.id,
          organizationId: org.id,
          organizationName: org.name,
          propertyName: l.unit.property.name,
          unitLabel: l.unit.label,
          title: l.title,
          unitType: l.unitType,
          area: l.area,
          monthlyRent: Number(l.monthlyRent),
          contactName: l.contactName,
          contactPhone: l.contactPhone,
          state: listingState(l, now),
          paidUntil: l.paidUntil,
          blockedReason: l.blockedAt ? (l.blockedReason ?? null) : null,
          blockedAt: l.blockedAt,
          photoCount: l.photos.length,
          coverImage: l.photos[0] ? this.storage.publicUrl(l.photos[0].storageKey) : null,
          timesPaid: mine.length,
          totalPaid: mine.length * LISTING_FEE_KES,
          createdAt: l.createdAt,
        });
      }
    }
    const count = (state: string) => rows.filter((r) => r.state === state).length;
    return {
      summary: {
        total: rows.length,
        live: count('LIVE'),
        unpaid: count('UNPAID'),
        expired: count('EXPIRED'),
        paused: count('PAUSED'),
        blocked: count('BLOCKED'),
        totalCollected: rows.reduce((sum, r) => sum + r.totalPaid, 0),
      },
      adverts: rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    };
  }

  /** Takes an advert off the public pages and stops the landlord switching it back on. The paid time is kept. */
  async block(organizationId: string, listingId: string, reason: string) {
    return this.runAsTenant(organizationId, async (tx) => {
      const listing = await tx.rentalListing.findUnique({ where: { id: listingId } });
      if (!listing) throw new NotFoundException('Advert not found');
      if (listing.blockedAt) throw new ConflictException('This advert is already taken down');
      await tx.rentalListing.update({ where: { id: listingId }, data: { isActive: false, blockedAt: new Date(), blockedReason: reason.trim() } });
      return { ok: true };
    });
  }

  /** Lifts a takedown. The advert stays switched off - the landlord decides when to resume it. */
  async unblock(organizationId: string, listingId: string) {
    return this.runAsTenant(organizationId, async (tx) => {
      const listing = await tx.rentalListing.findUnique({ where: { id: listingId } });
      if (!listing) throw new NotFoundException('Advert not found');
      if (!listing.blockedAt) throw new ConflictException('This advert is not taken down');
      await tx.rentalListing.update({ where: { id: listingId }, data: { blockedAt: null, blockedReason: null } });
      return { ok: true };
    });
  }
}
