import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';

/** Which properties each of the landlord's caretakers may work on. Managed by owners and managers only. */
@Injectable()
export class RentalCaretakersService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /** Active caretakers with the ids of the properties they are assigned to. */
  async list() {
    return this.tenantPrisma.run(async (tx) => {
      const caretakers = await tx.orgUser.findMany({
        where: { role: 'CARETAKER', isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, user: { select: { fullName: true, email: true } }, caretakerProperties: { select: { propertyId: true } } },
      });
      return caretakers.map((c) => ({
        id: c.id,
        fullName: c.user.fullName,
        email: c.user.email,
        propertyIds: c.caretakerProperties.map((p) => p.propertyId),
      }));
    });
  }

  /** Replaces the caretaker's properties with exactly this list (an empty list = they see nothing). */
  async setProperties(orgUserId: string, propertyIds: string[]) {
    const { organizationId } = getTenantStore();
    const wanted = [...new Set(propertyIds)];
    await this.tenantPrisma.run(async (tx) => {
      const caretaker = await tx.orgUser.findFirst({ where: { id: orgUserId, role: 'CARETAKER' }, select: { id: true } });
      if (!caretaker) throw new NotFoundException('Caretaker not found');
      const found = await tx.rentalProperty.count({ where: { id: { in: wanted } } });
      if (found !== wanted.length) throw new BadRequestException('One of those properties was not found');

      await tx.rentalCaretakerProperty.deleteMany({ where: { orgUserId, propertyId: { notIn: wanted } } });
      await tx.rentalCaretakerProperty.createMany({
        data: wanted.map((propertyId) => ({ organizationId, orgUserId, propertyId })),
        skipDuplicates: true,
      });
    });
    return this.list();
  }
}
