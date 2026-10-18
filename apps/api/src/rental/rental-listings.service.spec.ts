import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { LISTING_LIFETIME_DAYS, RentalListingsService, listingPhotoPrefix, listingState } from './rental-listings.service';
import { RENTAL_PLANS, planHas } from './rental-plans.util';

const ORG = '11111111-1111-1111-1111-111111111111';
const UNIT = '22222222-2222-2222-2222-222222222222';
const LISTING = '33333333-3333-3333-3333-333333333333';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const DAY = 86_400_000;

const dto = {
  title: 'Spacious bedsitter',
  unitType: 'BEDSITTER' as const,
  area: 'Kasarani',
  monthlyRent: 8000,
  depositAmount: 8000,
  contactPhone: '0712 345 678',
};

function setup(opts: { plan?: string; unitStatus?: 'VACANT' | 'OCCUPIED'; photoCount?: number } = {}) {
  const tx = {
    rentalSettings: { findUnique: jest.fn().mockResolvedValue({ plan: opts.plan ?? 'starter', pendingPlan: null, pendingPlanFrom: null }) },
    rentalUnit: { findUnique: jest.fn().mockResolvedValue({ id: UNIT, status: opts.unitStatus ?? 'VACANT' }) },
    rentalListing: {
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: LISTING, photos: [], ...create })),
      findUnique: jest.fn().mockResolvedValue({ id: LISTING, unitId: UNIT, isActive: true, confirmedAt: new Date(), photos: [] }),
    },
    rentalListingPhoto: {
      count: jest.fn().mockResolvedValue(opts.photoCount ?? 0),
      findMany: jest.fn().mockResolvedValue(Array.from({ length: opts.photoCount ?? 0 }, (_, i) => ({ sortOrder: i }))),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'p1', ...data })),
    },
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const storage = {
    upload: jest.fn().mockResolvedValue(undefined),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    publicUrl: jest.fn((k: string) => `https://cdn.example/${k}`),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new RentalListingsService(tenantPrisma as any, storage as any);
  return { service, tx, storage };
}

const asTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, fn);

describe('plans', () => {
  it('advertising is a paid feature: Starter and Pay-as-you-collect have it, Bure does not', () => {
    expect(planHas(RENTAL_PLANS.bure, 'advertise')).toBe(false);
    expect(planHas(RENTAL_PLANS.starter, 'advertise')).toBe(true);
    expect(planHas(RENTAL_PLANS.collect, 'advertise')).toBe(true);
  });
});

describe('listingState', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  it('is LIVE for 30 days after confirmation, then EXPIRED', () => {
    expect(listingState({ isActive: true, confirmedAt: new Date(now.getTime() - 29 * DAY) }, now)).toBe('LIVE');
    expect(listingState({ isActive: true, confirmedAt: new Date(now.getTime() - (LISTING_LIFETIME_DAYS + 1) * DAY) }, now)).toBe('EXPIRED');
  });
  it('is PAUSED whenever switched off', () => {
    expect(listingState({ isActive: false, confirmedAt: now }, now)).toBe('PAUSED');
  });
});

describe('RentalListingsService', () => {
  it('lets a Starter landlord advertise a vacant unit and goes live', async () => {
    const { service, tx } = setup();
    const view = await asTenant(() => service.upsertForUnit(UNIT, dto));
    expect(tx.rentalListing.upsert).toHaveBeenCalled();
    expect(view.state).toBe('LIVE');
    expect(view.monthlyRent).toBe(8000);
  });

  it('refuses a Bure (free) landlord with an upgrade message', async () => {
    const { service, tx } = setup({ plan: 'bure' });
    await expect(asTenant(() => service.upsertForUnit(UNIT, dto))).rejects.toThrow(/Starter/);
    expect(tx.rentalListing.upsert).not.toHaveBeenCalled();
  });

  it('refuses to advertise an occupied unit', async () => {
    const { service } = setup({ unitStatus: 'OCCUPIED' });
    await expect(asTenant(() => service.upsertForUnit(UNIT, dto))).rejects.toThrow(ConflictException);
  });

  describe('addPhoto', () => {
    it('stores a photo under this landlord and advert', async () => {
      const { service, storage } = setup();
      const photo = await asTenant(() => service.addPhoto(LISTING, 'image/jpeg', JPEG));
      expect(storage.upload.mock.calls[0][0].startsWith(listingPhotoPrefix(ORG, LISTING))).toBe(true);
      expect(photo.sortOrder).toBe(0);
    });

    it('rejects fake images and non-images without touching storage', async () => {
      const { service, storage } = setup();
      await expect(asTenant(() => service.addPhoto(LISTING, 'image/png', Buffer.from('<html>')))).rejects.toThrow(/not a valid/);
      await expect(asTenant(() => service.addPhoto(LISTING, 'application/pdf', JPEG))).rejects.toThrow(BadRequestException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('stops at 8 photos', async () => {
      const { service, storage } = setup({ photoCount: 8 });
      await expect(asTenant(() => service.addPhoto(LISTING, 'image/jpeg', JPEG))).rejects.toThrow(/at most 8/);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('removes the stored file again if recording it fails', async () => {
      const { service, storage, tx } = setup();
      tx.rentalListingPhoto.create.mockRejectedValueOnce(new Error('db down'));
      await expect(asTenant(() => service.addPhoto(LISTING, 'image/jpeg', JPEG))).rejects.toThrow('db down');
      expect(storage.deleteMany).toHaveBeenCalledWith([storage.upload.mock.calls[0][0]]);
    });
  });
});
