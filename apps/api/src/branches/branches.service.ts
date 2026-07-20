import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  create(dto: CreateBranchDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.branch.create({ data: { ...dto, organizationId } }),
    );
  }

  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.branch.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  async findOne(id: string) {
    const branch = await this.tenantPrisma.run((tx) =>
      tx.branch.findUnique({ where: { id } }),
    );
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);
    return this.tenantPrisma.run((tx) =>
      tx.branch.update({ where: { id }, data: dto }),
    );
  }
}
