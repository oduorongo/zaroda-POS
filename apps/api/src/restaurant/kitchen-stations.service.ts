import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KitchenTicketStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/tab.dto';

@Injectable()
export class KitchenStationsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private duplicate(name: string): never {
    throw new ConflictException(
      `A station named "${name}" already exists at this branch`,
    );
  }

  async create(dto: CreateStationDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const branch = await tx.branch.findUnique({
          where: { id: dto.branchId },
        });
        if (!branch) throw new NotFoundException('Branch not found');

        return tx.kitchenStation.create({
          data: { organizationId, branchId: dto.branchId, name: dto.name },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        this.duplicate(dto.name);
      throw e;
    }
  }

  findAll(filters: { branchId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.kitchenStation.findMany({
        where: { branchId: filters.branchId, archivedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async update(id: string, dto: UpdateStationDto) {
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const station = await tx.kitchenStation.findUnique({ where: { id } });
        if (!station || station.archivedAt)
          throw new NotFoundException('Station not found');
        const updated = await tx.kitchenStation.update({
          where: { id },
          data: { name: dto.name },
        });
        await this.auditLog.logInTx(tx, {
          action: 'restaurant.station_updated',
          entityType: 'KitchenStation',
          entityId: id,
          before: { name: station.name },
          after: { name: updated.name },
        });
        return updated;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        this.duplicate(dto.name);
      throw e;
    }
  }

  /**
   * Removes a station. Refused while it has tickets the kitchen has not finished. A station that has been used is archived
   * rather than deleted (its dishes then go to the branch's first station); one that never was is deleted.
   */
  async remove(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const station = await tx.kitchenStation.findUnique({ where: { id } });
      if (!station || station.archivedAt)
        throw new NotFoundException('Station not found');
      const unfinished = await tx.kitchenTicket.count({
        where: { stationId: id, status: { not: KitchenTicketStatus.SERVED } },
      });
      if (unfinished > 0)
        throw new ConflictException(
          `This station still has ${unfinished} unfinished ${unfinished === 1 ? 'ticket' : 'tickets'}. Finish them first.`,
        );
      const used =
        (await tx.kitchenTicket.count({ where: { stationId: id } })) +
        (await tx.restaurantTabLine.count({ where: { stationId: id } }));
      if (used > 0) {
        await tx.kitchenStation.update({
          where: { id },
          data: {
            archivedAt: new Date(),
            name: `${station.name} (removed ${id.slice(0, 6)})`,
          },
        });
        await this.auditLog.logInTx(tx, {
          action: 'restaurant.station_archived',
          entityType: 'KitchenStation',
          entityId: id,
          before: { name: station.name },
        });
        return { archived: true };
      }
      await tx.kitchenStation.delete({ where: { id } });
      await this.auditLog.logInTx(tx, {
        action: 'restaurant.station_deleted',
        entityType: 'KitchenStation',
        entityId: id,
        before: { name: station.name },
      });
      return { archived: false };
    });
  }
}
