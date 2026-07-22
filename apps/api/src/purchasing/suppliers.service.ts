import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  create(dto: CreateSupplierDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.supplier.create({ data: { ...dto, organizationId } }),
    );
  }

  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.supplier.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  async findOne(id: string) {
    const supplier = await this.tenantPrisma.run((tx) =>
      tx.supplier.findUnique({ where: { id } }),
    );
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.tenantPrisma.run((tx) =>
      tx.supplier.update({ where: { id }, data: dto }),
    );
  }
}
