import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateResourceDto } from './dto/create-resource.dto';

@Injectable()
export class SalonResourcesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async create(dto: CreateResourceDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const branch = await tx.branch.findUnique({
          where: { id: dto.branchId },
        });
        if (!branch) throw new NotFoundException('Branch not found');

        return tx.salonResource.create({
          data: { organizationId, branchId: dto.branchId, name: dto.name },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `A resource named "${dto.name}" already exists at this branch`,
        );
      }
      throw e;
    }
  }

  findAll(filters: { branchId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.salonResource.findMany({
        where: { branchId: filters.branchId },
        orderBy: { name: 'asc' },
      }),
    );
  }
}
