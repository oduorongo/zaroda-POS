import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  create(dto: CreateCategoryDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.category.create({ data: { ...dto, organizationId } }),
    );
  }

  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.category.findMany({ orderBy: { name: 'asc' } }),
    );
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
    return this.tenantPrisma.run((tx) =>
      tx.category.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.tenantPrisma.run((tx) => tx.category.delete({ where: { id } }));
  }
}
