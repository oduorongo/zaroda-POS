import { ForbiddenException } from '@nestjs/common';
import { RentalBusinessGuard } from './rental-business.guard';

const types: Record<string, string> = { landlord: 'RENTAL', farm: 'FARM', builder: 'CONSTRUCTION' };
const prisma = { organization: { findUnique: jest.fn(async ({ where }) => (types[where.id] ? { industryType: types[where.id] } : null)) } };
const ctx = (organizationId?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ user: organizationId ? { organizationId } : undefined }) }) }) as never;

describe('RentalBusinessGuard', () => {
  const guard = new RentalBusinessGuard(prisma as never);

  it('lets a rental business in', async () => {
    await expect(guard.canActivate(ctx('landlord'))).resolves.toBe(true);
  });

  it('turns away a farm, a contractor and an unknown business', async () => {
    for (const id of ['farm', 'builder', 'nobody']) {
      await expect(guard.canActivate(ctx(id))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('needs a signed-in business', async () => {
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('remembers the type instead of asking the database every time', async () => {
    prisma.organization.findUnique.mockClear();
    await guard.canActivate(ctx('landlord'));
    await guard.canActivate(ctx('landlord'));
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });
});
