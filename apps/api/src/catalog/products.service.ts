import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  create(dto: CreateProductDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.product.create({ data: { ...dto, organizationId } }),
    );
  }

  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.product.findMany({
        orderBy: { name: 'asc' },
        include: { variants: true, category: true },
      }),
    );
  }

  async findOne(id: string) {
    const product = await this.tenantPrisma.run((tx) =>
      tx.product.findUnique({
        where: { id },
        include: { variants: true, category: true },
      }),
    );
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    return this.tenantPrisma.run((tx) =>
      tx.product.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.tenantPrisma.run((tx) => tx.product.delete({ where: { id } }));
  }
}
