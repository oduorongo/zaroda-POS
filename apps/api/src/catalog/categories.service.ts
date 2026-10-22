import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /** One category per name per business, whatever the capitals (the database enforces it; this turns its refusal into a sentence). */
  private nameTaken(name: string | undefined, e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException(`You already have a category called "${name ?? ''}" (capital letters do not matter). Use that one, or choose a different name.`);
    }
    throw e;
  }

  async create(dto: CreateCategoryDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run((tx) =>
        tx.category.create({ data: { ...dto, organizationId } }),
      );
    } catch (e) {
      return this.nameTaken(dto.name, e);
    }
  }

  /** The categories, each with how many products are in it when asked (the products of archived items are not counted). */
  async findAll(withCounts = false) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.category.findMany({
        orderBy: { name: 'asc' },
        ...(withCounts ? { include: { _count: { select: { products: { where: { isActive: true } } } } } } : {}),
      }),
    );
    return withCounts
      ? rows.map((r) => {
          const { _count, ...rest } = r as typeof r & { _count: { products: number } };
          return { ...rest, productCount: _count.products };
        })
      : rows;
  }

  async findOne(id: string) {
    const category = await this.tenantPrisma.run((tx) =>
      tx.category.findUnique({ where: { id } }),
    );
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id); // 404 before a possibly-confusing RLS-driven update-affected-0-rows result
    try {
      return await this.tenantPrisma.run((tx) =>
        tx.category.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      return this.nameTaken(dto.name, e);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.tenantPrisma.run((tx) => tx.category.delete({ where: { id } }));
  }
}
