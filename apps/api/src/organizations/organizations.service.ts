import { Injectable } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

const SELECT = {
  id: true,
  name: true,
  industryType: true,
  country: true,
  baseCurrency: true,
  kraPin: true,
  vatRegistered: true,
} as const;

@Injectable()
export class OrganizationsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async findMine() {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: SELECT,
      }),
    );
  }

  async updateMine(dto: UpdateOrganizationDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.organization.update({
        where: { id: organizationId },
        data: dto,
        select: SELECT,
      }),
    );
  }
}
