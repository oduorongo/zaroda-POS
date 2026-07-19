import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';

@Injectable()
export class RestaurantTablesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async create(dto: CreateTableDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const branch = await tx.branch.findUnique({
          where: { id: dto.branchId },
        });
        if (!branch) throw new NotFoundException('Branch not found');

        return tx.restaurantTable.create({
          data: {
            organizationId,
            branchId: dto.branchId,
            label: dto.label,
            seats: dto.seats,
          },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `A table labeled "${dto.label}" already exists at this branch`,
        );
      }
      throw e;
    }
  }

  findAll(filters: { branchId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.restaurantTable.findMany({
        where: { branchId: filters.branchId },
        orderBy: { label: 'asc' },
      }),
    );
  }

  async findOne(id: string) {
    const table = await this.tenantPrisma.run((tx) =>
      tx.restaurantTable.findUnique({ where: { id } }),
    );
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  async updateStatus(id: string, dto: UpdateTableStatusDto) {
    return this.tenantPrisma.run(async (tx) => {
      const table = await tx.restaurantTable.findUnique({ where: { id } });
      if (!table) throw new NotFoundException('Table not found');

      return tx.restaurantTable.update({
        where: { id },
        data: { status: dto.status },
      });
    });
  }
}
