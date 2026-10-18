import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { RentalListingsService } from './rental-listings.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const SOURCE = '22222222-2222-2222-2222-222222222220';
const U_SOURCE = 'unit-source';

const sourceListing = (over: Record<string, unknown> = {}) => ({
  id: SOURCE,
  unitId: U_SOURCE,
  title: 'Spacious bedsitter',
  unitType: 'BEDSITTER',
  area: 'Kasarani',
  monthlyRent: 8000,
  depositAmount: 8000,
  description: 'Gated, water 24/7',
  contactName: 'Mama Pima',
  contactPhone: '0712345678',
  isActive: true,
  paidUntil: new Date(Date.now() + 5 * 86_400_000),
  blockedAt: null,
  blockedReason: null,
  photos: [{ id: 'p1', storageKey: 'a.jpg', sortOrder: 0 }],
  ...over,
});

const unit = (id: string, over: Record<string, unknown> = {}) => ({ id, status: 'VACANT', monthlyRent: 6500, depositAmount: 3000, listing: null, ...over });

function setup(units: Record<string, unknown>[], source = sourceListing()) {
  const create = jest.fn(async ({ data }: { data: { unitId: string } }) => ({ id: `new-${data.unitId}`, ...data }));
  const tx = {
    rentalListing: { findUnique: jest.fn(async () => source), create },
    rentalUnit: { findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => units.filter((u) => where.id.in.includes(String(u.id)))) },
  };
  const tenantPrisma = { run: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new RentalListingsService(tenantPrisma as any, { publicUrl: (k: string) => k } as any);
  return { service, create };
}

const asTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, fn);

describe('copying an advert to other units', () => {
  it('creates an unpaid advert per vacant unit with the same details, using each unit’s own rent', async () => {
    const { service, create } = setup([unit('u1'), unit('u2')]);
    const result = await asTenant(() => service.copyTo(SOURCE, { unitIds: ['u1', 'u2'], useOwnRent: true }));
    expect(result.created).toBe(2);
    expect(result.createdIds).toEqual(['new-u1', 'new-u2']);
    expect(create.mock.calls[0][0].data).toMatchObject({
      organizationId: ORG,
      unitId: 'u1',
      title: 'Spacious bedsitter',
      unitType: 'BEDSITTER',
      area: 'Kasarani',
      description: 'Gated, water 24/7',
      contactName: 'Mama Pima',
      contactPhone: '0712345678',
      monthlyRent: 6500,
      depositAmount: 3000,
      isActive: true,
    });
  });

  it('can use this advert’s rent and deposit for every unit instead', async () => {
    const { service, create } = setup([unit('u1')]);
    await asTenant(() => service.copyTo(SOURCE, { unitIds: ['u1'], useOwnRent: false }));
    expect(create.mock.calls[0][0].data).toMatchObject({ monthlyRent: 8000, depositAmount: 8000 });
  });

  it('does not copy photos, and never sets paid time - a copy is not public until paid for', async () => {
    const { service, create } = setup([unit('u1')]);
    await asTenant(() => service.copyTo(SOURCE, { unitIds: ['u1'], useOwnRent: true }));
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('photos');
    expect(data).not.toHaveProperty('paidUntil');
  });

  it('skips units that are let, already advertised, or the source itself, and says why', async () => {
    const { service, create } = setup([
      unit('free'),
      unit('let', { status: 'OCCUPIED' }),
      unit('has-advert', { listing: { id: 'x' } }),
      unit(U_SOURCE),
    ]);
    const result = await asTenant(() => service.copyTo(SOURCE, { unitIds: ['free', 'let', 'has-advert', U_SOURCE], useOwnRent: true }));
    expect(result.created).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.skipped.map((s) => s.unitId).sort()).toEqual(['has-advert', 'let', U_SOURCE].sort());
    expect(result.skipped.find((s) => s.unitId === 'let')?.reason).toMatch(/let/);
  });

  it('refuses to copy an advert Zaroda has taken down', async () => {
    const { service, create } = setup([unit('u1')], sourceListing({ blockedAt: new Date(), blockedReason: 'fake' }));
    await expect(asTenant(() => service.copyTo(SOURCE, { unitIds: ['u1'], useOwnRent: true }))).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('fails cleanly if one of the units does not belong to this landlord', async () => {
    const { service, create } = setup([unit('u1')]);
    await expect(asTenant(() => service.copyTo(SOURCE, { unitIds: ['u1', 'someone-elses'], useOwnRent: true }))).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });
});
