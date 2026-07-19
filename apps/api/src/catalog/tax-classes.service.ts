import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateTaxClassDto, UpdateTaxClassDto } from './dto/tax-class.dto';

@Injectable()
export class TaxClassesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  create(dto: CreateTaxClassDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.taxClass.create({ data: { ...dto, organizationId } }),
    );
  }

  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.taxClass.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  async findOne(id: string) {
    const taxClass = await this.tenantPrisma.run((tx) =>
      tx.taxClass.findUnique({ where: { id } }),
    );
    if (!taxClass) throw new NotFoundException('Tax class not found');
    return taxClass;
  }

  async update(id: string, dto: UpdateTaxClassDto) {
    await this.findOne(id);
    return this.tenantPrisma.run((tx) =>
      tx.taxClass.update({ where: { id }, data: dto }),
    );
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.tenantPrisma.run((tx) => tx.taxClass.delete({ where: { id } }));
  }
}
