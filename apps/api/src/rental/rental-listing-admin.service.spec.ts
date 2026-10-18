import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { listingState } from './rental-listing-fee.util';
import { RentalListingAdminService } from './rental-listing-admin.service';
import { RentalListingsService } from './rental-listings.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const LISTING = '22222222-2222-2222-2222-222222222222';
const DAY = 86_400_000;

function adminSetup(listing: Record<string, unknown> | null, payments: Record<string, unknown>[] = []) {
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    rentalListing: {
      findMany: jest.fn(async () => (listing ? [listing] : [])),
      findUnique: jest.fn(async () => listing),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        listing = { ...listing, ...data };
        return listing;
      }),
    },
    rentalListingPayment: { findMany: jest.fn(async () => payments) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    organization: { findMany: jest.fn(async () => [{ id: ORG, name: 'Mama Pima Rentals' }]) },
  };
  const storage = { publicUrl: (k: string) => `https://cdn.example/${k}` };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new RentalListingAdminService(prisma as any, storage as any);
  return { service, tx, current: () => listing };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: LISTING,
  unitId: 'u1',
  title: 'Bedsitter',
  unitType: 'BEDSITTER',
  area: 'Kasarani',
  monthlyRent: 5000,
  contactName: null,
  contactPhone: '0712345678',
  isActive: true,
  paidUntil: new Date(Date.now() + 10 * DAY),
  blockedAt: null,
  blockedReason: null,
  createdAt: new Date(),
  photos: [{ storageKey: 'a.jpg' }],
  unit: { label: 'A1', property: { name: 'Block A' } },
  ...over,
});

describe('listingState with a takedown', () => {
  it('BLOCKED beats everything, even a paid live advert', () => {
    expect(listingState({ isActive: true, paidUntil: new Date(Date.now() + DAY), blockedAt: new Date() })).toBe('BLOCKED');
    expect(listingState({ isActive: false, paidUntil: null, blockedAt: new Date() })).toBe('BLOCKED');
  });
});

describe('RentalListingAdminService', () => {
  it('lists every landlord’s adverts with their state, owner and what they have paid', async () => {
    const { service } = adminSetup(row(), [{ amount: 100, listingIds: [LISTING], listingId: LISTING }, { amount: 300, listingIds: ['x', LISTING, 'y'], listingId: 'x' }]);
    const result = await service.list();
    expect(result.summary).toMatchObject({ total: 1, live: 1, blocked: 0, totalCollected: 200 });
    expect(result.adverts[0]).toMatchObject({ organizationName: 'Mama Pima Rentals', propertyName: 'Block A', unitLabel: 'A1', state: 'LIVE', timesPaid: 2, photoCount: 1 });
  });

  it('takes an advert down: switched off, reason stored, shown as BLOCKED', async () => {
    const { service, current } = adminSetup(row());
    await service.block(ORG, LISTING, '  Fake photos  ');
    expect(current()).toMatchObject({ isActive: false, blockedReason: 'Fake photos' });
    expect(current()?.blockedAt).toBeInstanceOf(Date);
  });

  it('cannot take down twice, or restore what is not taken down, or find an unknown advert', async () => {
    await expect(adminSetup(row({ blockedAt: new Date() })).service.block(ORG, LISTING, 'again')).rejects.toThrow(ConflictException);
    await expect(adminSetup(row()).service.unblock(ORG, LISTING)).rejects.toThrow(ConflictException);
    await expect(adminSetup(null).service.block(ORG, LISTING, 'why')).rejects.toThrow(NotFoundException);
  });

  it('restoring lifts the block but leaves the advert switched off for the landlord to resume', async () => {
    const { service, current } = adminSetup(row({ isActive: false, blockedAt: new Date(), blockedReason: 'x' }));
    await service.unblock(ORG, LISTING);
    expect(current()).toMatchObject({ isActive: false, blockedAt: null, blockedReason: null });
  });
});

describe('a landlord and a taken-down advert', () => {
  it('cannot switch it back on', async () => {
    const blocked = row({ isActive: false, blockedAt: new Date(), blockedReason: 'Fake photos' });
    const tx = {
      rentalListing: { findUnique: jest.fn(async () => blocked), update: jest.fn() },
      rentalUnit: { findUnique: jest.fn(async () => ({ status: 'VACANT' })) },
    };
    const tenantPrisma = { run: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new RentalListingsService(tenantPrisma as any, { publicUrl: (k: string) => k } as any);
    await expect(
      tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, () => service.setActive(LISTING, { isActive: true })),
    ).rejects.toThrow(/Fake photos/);
    expect(tx.rentalListing.update).not.toHaveBeenCalled();
  });
});
