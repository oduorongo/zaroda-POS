import { Injectable } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';

@Injectable()
export class OrganizationsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async findMine() {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          industryType: true,
          country: true,
          baseCurrency: true,
        },
      }),
    );
  }
}
