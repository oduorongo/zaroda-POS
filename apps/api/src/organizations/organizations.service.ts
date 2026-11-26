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
  address: true,
  phone: true,
  email: true,
  invoiceFooter: true,
} as const;

@Injectable()
export class OrganizationsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /** The business, and the signed-in user's name (printed on reports as who prepared them). */
  async findMine() {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: SELECT });
      const me = await tx.orgUser.findUnique({ where: { id: orgUserId }, select: { user: { select: { fullName: true } } } });
      return { ...org, me: { fullName: me?.user.fullName ?? null } };
    });
  }

  async updateMine(dto: UpdateOrganizationDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run((tx) =>
      tx.organization.update({
        where: { id: organizationId },
        data: {
          ...dto,
          // an emptied box clears the detail
          address: dto.address === undefined ? undefined : dto.address.trim() || null,
          phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
          email: dto.email === undefined ? undefined : dto.email.trim() || null,
          invoiceFooter: dto.invoiceFooter === undefined ? undefined : dto.invoiceFooter.trim() || null,
        },
        select: SELECT,
      }),
    );
  }
}
