import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { RidersService, isProfileComplete } from './riders.service';

const rider = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  email: 'rider@example.com',
  fullName: 'Juma Otieno',
  phone: '254712345678',
  vehicleType: 'BODA',
  plateNumber: 'KMFA 123A',
  area: 'Milimani',
  status: 'PENDING',
  organizationId: null,
  createdAt: new Date(),
  ...over,
});

function setup(opts: { addon?: boolean } = {}) {
  const prisma = {
    rider: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(rider(data))),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(rider(data))),
    },
  };
  const tx = { onlineStore: { findUnique: jest.fn().mockResolvedValue({ addonActive: opts.addon ?? true }) } };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new RidersService(prisma as any, tenantPrisma as any, { getOrThrow: () => 'test-secret' } as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, prisma };
}
const asShop = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: 'org-1', orgUserId: 'u1' } as never, fn);

const dto = { email: ' New@Rider.COM ', fullName: ' Juma Otieno ', phone: '0712 345 678', vehicleType: 'BODA' as const, plateNumber: 'kmfa 123a' };

describe('isProfileComplete', () => {
  it('needs a name, a phone and a vehicle', () => {
    expect(isProfileComplete(rider() as never)).toBe(true);
    expect(isProfileComplete(rider({ fullName: null }) as never)).toBe(false);
    expect(isProfileComplete(rider({ phone: null }) as never)).toBe(false);
    expect(isProfileComplete(rider({ vehicleType: null }) as never)).toBe(false);
  });
});

describe('RidersService (a business\'s own riders)', () => {
  it('lists only the riders that belong to this business', async () => {
    const { service, prisma } = setup();
    await asShop(() => service.listForShop());
    expect(prisma.rider.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
  });

  it('adds a rider, approved straight away and tied to this business', async () => {
    const { service, prisma } = setup();
    const view = await asShop(() => service.createForShop(dto));
    expect(prisma.rider.create.mock.calls[0][0].data).toMatchObject({
      email: 'new@rider.com',
      fullName: 'Juma Otieno',
      phone: '254712345678',
      plateNumber: 'KMFA 123A',
      organizationId: 'org-1',
      status: 'APPROVED',
    });
    expect(view).toMatchObject({ status: 'APPROVED', kind: 'SHOP' });
  });

  it('refuses when the Online Shop add-on is not active', async () => {
    const { service, prisma } = setup({ addon: false });
    await expect(asShop(() => service.createForShop(dto))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rider.create).not.toHaveBeenCalled();
  });

  it('refuses a bad phone number, and says plainly when the email or phone is already taken', async () => {
    const { service, prisma } = setup();
    await expect(asShop(() => service.createForShop({ ...dto, phone: '123' }))).rejects.toBeInstanceOf(BadRequestException);
    const dup = (target: string) => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: [target] } });
    prisma.rider.create.mockRejectedValueOnce(dup('email'));
    await expect(asShop(() => service.createForShop(dto))).rejects.toThrow('That email address is already registered as a rider');
    prisma.rider.create.mockRejectedValueOnce(dup('phone'));
    await expect(asShop(() => service.createForShop(dto))).rejects.toBeInstanceOf(ConflictException);
  });

  it('cannot touch a rider of another business or of the pool - it is simply "not found"', async () => {
    const { service, prisma } = setup();
    prisma.rider.findFirst.mockResolvedValue(null);
    await expect(asShop(() => service.setStatusForShop('r-other', 'SUSPENDED'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(asShop(() => service.updateForShop('r-other', { area: 'x' }))).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.rider.findFirst.mock.calls[0][0].where).toEqual({ id: 'r-other', organizationId: 'org-1' });
    expect(prisma.rider.update).not.toHaveBeenCalled();
  });

  it('suspends and re-approves its own rider', async () => {
    const { service, prisma } = setup();
    prisma.rider.findFirst.mockResolvedValue(rider({ organizationId: 'org-1', status: 'APPROVED' }));
    await asShop(() => service.setStatusForShop('r1', 'SUSPENDED'));
    expect(prisma.rider.update.mock.calls[0][0].data).toMatchObject({ status: 'SUSPENDED' });
  });
});

describe('RidersService (a rider\'s own profile)', () => {
  it('saves the profile with a normalized phone and an upper-case plate, for that rider only', async () => {
    const { service, prisma } = setup();
    await service.updateMe('r1', { fullName: ' Juma ', phone: '0712345678', plateNumber: 'kmfa 123a', vehicleType: 'TUK_TUK' });
    expect(prisma.rider.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'r1' },
      data: { fullName: 'Juma', phone: '254712345678', plateNumber: 'KMFA 123A', vehicleType: 'TUK_TUK' },
    });
  });

  it('only changes the fields that were sent', async () => {
    const { service, prisma } = setup();
    await service.updateMe('r1', { area: 'Town' });
    const data = prisma.rider.update.mock.calls[0][0].data;
    expect(data.area).toBe('Town');
    expect(data.fullName).toBeUndefined();
    expect(data.phone).toBeUndefined();
    expect(data.plateNumber).toBeUndefined();
  });
});

describe('RidersService (platform admin)', () => {
  it('will not approve a rider who has not finished their profile', async () => {
    const { service, prisma } = setup();
    prisma.rider.findUnique.mockResolvedValue(rider({ fullName: null }));
    await expect(service.setStatusForAdmin('r1', 'APPROVED')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.rider.update).not.toHaveBeenCalled();
  });

  it('approves a complete rider, and can suspend anyone', async () => {
    const { service, prisma } = setup();
    prisma.rider.findUnique.mockResolvedValue(rider());
    expect(await service.setStatusForAdmin('r1', 'APPROVED')).toMatchObject({ status: 'APPROVED' });
    prisma.rider.findUnique.mockResolvedValue(rider({ fullName: null }));
    await service.setStatusForAdmin('r1', 'SUSPENDED');
    expect(prisma.rider.update).toHaveBeenCalledTimes(2);
  });

  it('says "not found" for an unknown rider', async () => {
    const { service, prisma } = setup();
    prisma.rider.findUnique.mockResolvedValue(null);
    await expect(service.setStatusForAdmin('nope', 'APPROVED')).rejects.toBeInstanceOf(NotFoundException);
  });
});
