import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CategoriesService } from './categories.service';

jest.mock('../common/tenant/tenant-context', () => ({
  getTenantStore: () => ({ organizationId: 'org-1' }),
}));

const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

function setup(tx: Record<string, unknown>) {
  const tenantPrisma = {
    run: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CategoriesService(tenantPrisma as any);
}

describe('CategoriesService - one name per business', () => {
  it('turns the database refusing a duplicate name (any case) into a friendly 409', async () => {
    const service = setup({
      category: { create: jest.fn().mockRejectedValue(duplicate()) },
    });
    const attempt = service.create({ name: 'drinks' });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(
      /already have a category called "drinks".*capital letters do not matter/,
    );
  });

  it('does the same when renaming a category to a name that is taken', async () => {
    const service = setup({
      category: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1' }),
        update: jest.fn().mockRejectedValue(duplicate()),
      },
    });
    await expect(
      service.update('c1', { name: 'Bakery' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets other database errors through unchanged', async () => {
    const boom = new Error('connection lost');
    await expect(
      setup({ category: { create: jest.fn().mockRejectedValue(boom) } }).create(
        { name: 'x' },
      ),
    ).rejects.toBe(boom);
  });

  it('lists categories with how many (active) products each has, when asked', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'c1', name: 'Bakery', _count: { products: 4 } },
      ]);
    const service = setup({ category: { findMany } });
    expect(await service.findAll(true)).toEqual([
      { id: 'c1', name: 'Bakery', productCount: 4 },
    ]);
    expect(
      findMany.mock.calls[0][0].include._count.select.products.where,
    ).toEqual({ isActive: true });
    await service.findAll(false);
    expect(findMany.mock.calls[1][0].include).toBeUndefined();
  });
});
