import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RestaurantTabStatus,
  RestaurantTableStatus,
} from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateTableDto } from './dto/create-table.dto';
import { RestaurantSettingsDto, UpdateTableDto } from './dto/tab.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { billTotals, floorStatus } from './tab-bill.util';

const DEFAULT_RESERVE_LEAD_MINUTES = 60;
const DAY_MS = 86_400_000;

@Injectable()
export class RestaurantTablesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private duplicateLabel(label: string): never {
    throw new ConflictException(
      `A table labeled "${label}" already exists at this branch`,
    );
  }

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
      )
        this.duplicateLabel(dto.label);
      throw e;
    }
  }

  /**
   * The floor: every table with what it should show right now. A table with a confirmed reservation coming up shows Reserved
   * (unless it is occupied or needs cleaning), and a table with an open bill carries its running total.
   */
  async findAll(filters: { branchId?: string }) {
    return this.tenantPrisma.run(async (tx) => {
      const tables = await tx.restaurantTable.findMany({
        where: { branchId: filters.branchId, archivedAt: null },
        orderBy: { label: 'asc' },
      });
      const ids = tables.map((t) => t.id);
      const now = new Date();
      const [settings, reservations, tabs] = await Promise.all([
        tx.restaurantSetting.findMany({
          where: {
            branchId: { in: [...new Set(tables.map((t) => t.branchId))] },
          },
        }),
        tx.tableReservation.findMany({
          where: {
            tableId: { in: ids },
            status: 'CONFIRMED',
            date: {
              gte: new Date(now.getTime() - DAY_MS),
              lte: new Date(now.getTime() + 2 * DAY_MS),
            },
          },
        }),
        tx.restaurantTab.findMany({
          where: { tableId: { in: ids }, status: RestaurantTabStatus.OPEN },
          include: {
            lines: {
              where: { status: 'ORDERED' },
              include: {
                variant: {
                  include: {
                    product: {
                      select: {
                        taxClass: { select: { rate: true, isExempt: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);
      const lead = new Map(
        settings.map((s) => [s.branchId, s.reserveLeadMinutes]),
      );
      const tabOf = new Map(tabs.map((t) => [t.tableId, t]));
      return tables.map((t) => {
        const shown = floorStatus(
          t.status,
          reservations.filter((r) => r.tableId === t.id),
          lead.get(t.branchId) ?? DEFAULT_RESERVE_LEAD_MINUTES,
          now,
        );
        const tab = tabOf.get(t.id);
        const total = tab
          ? billTotals(
              tab.lines.map((l) => {
                const tc = l.variant.product.taxClass;
                return {
                  quantity: Number(l.quantity),
                  unitPrice: Number(l.variant.price),
                  taxRate: tc && !tc.isExempt ? Number(tc.rate) : 0,
                };
              }),
            ).total
          : 0;
        return {
          ...t,
          storedStatus: t.status,
          status: shown.status,
          reservation: shown.reservation,
          tab: tab
            ? {
                id: tab.id,
                openedAt: tab.openedAt,
                guestCount: tab.guestCount,
                itemCount: tab.lines.length,
                total,
              }
            : null,
        };
      });
    });
  }

  async findOne(id: string) {
    const table = await this.tenantPrisma.run((tx) =>
      tx.restaurantTable.findUnique({ where: { id } }),
    );
    if (!table || table.archivedAt)
      throw new NotFoundException('Table not found');
    return table;
  }

  async updateStatus(id: string, dto: UpdateTableStatusDto) {
    return this.tenantPrisma.run(async (tx) => {
      const table = await tx.restaurantTable.findUnique({ where: { id } });
      if (!table) throw new NotFoundException('Table not found');
      const updated = await tx.restaurantTable.update({
        where: { id },
        data: { status: dto.status },
      });
      await this.auditLog.logInTx(tx, {
        action: 'restaurant.table_status',
        entityType: 'RestaurantTable',
        entityId: id,
        before: { status: table.status },
        after: { status: dto.status },
      });
      return updated;
    });
  }

  /** "Mark clean": the table is free again. Not while a bill is open on it. */
  async markClean(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const table = await tx.restaurantTable.findUnique({ where: { id } });
      if (!table || table.archivedAt)
        throw new NotFoundException('Table not found');
      if (
        (await tx.restaurantTab.count({
          where: { tableId: id, status: RestaurantTabStatus.OPEN },
        })) > 0
      ) {
        throw new ConflictException(
          'There is an open bill on this table, so it is not free yet',
        );
      }
      const updated = await tx.restaurantTable.update({
        where: { id },
        data: { status: RestaurantTableStatus.AVAILABLE },
      });
      await this.auditLog.logInTx(tx, {
        action: 'restaurant.table_status',
        entityType: 'RestaurantTable',
        entityId: id,
        before: { status: table.status },
        after: { status: 'AVAILABLE' },
      });
      return updated;
    });
  }

  async update(id: string, dto: UpdateTableDto) {
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const table = await tx.restaurantTable.findUnique({ where: { id } });
        if (!table || table.archivedAt)
          throw new NotFoundException('Table not found');
        const updated = await tx.restaurantTable.update({
          where: { id },
          data: { label: dto.label, seats: dto.seats },
        });
        await this.auditLog.logInTx(tx, {
          action: 'restaurant.table_updated',
          entityType: 'RestaurantTable',
          entityId: id,
          before: { label: table.label, seats: table.seats },
          after: { label: updated.label, seats: updated.seats },
        });
        return updated;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        this.duplicateLabel(dto.label ?? '');
      throw e;
    }
  }

  /**
   * Removes a table. Refused while it has an open bill. A table that has been used (bills, sales, online orders) is archived
   * rather than deleted, so history keeps pointing at it; its label is freed for a new table.
   */
  async remove(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const table = await tx.restaurantTable.findUnique({ where: { id } });
      if (!table || table.archivedAt)
        throw new NotFoundException('Table not found');
      if (
        (await tx.restaurantTab.count({
          where: { tableId: id, status: RestaurantTabStatus.OPEN },
        })) > 0
      ) {
        throw new ConflictException(
          'This table has an open bill. Pay or throw away the bill first.',
        );
      }
      const [tabs, sales, orders] = await Promise.all([
        tx.restaurantTab.count({ where: { tableId: id } }),
        tx.restaurantSaleTable.count({ where: { tableId: id } }),
        tx.onlineOrder.count({ where: { tableId: id } }),
      ]);
      if (tabs + sales + orders > 0) {
        await tx.restaurantTable.update({
          where: { id },
          data: {
            archivedAt: new Date(),
            label: `${table.label} (removed ${id.slice(0, 6)})`,
            status: RestaurantTableStatus.AVAILABLE,
          },
        });
        await this.auditLog.logInTx(tx, {
          action: 'restaurant.table_archived',
          entityType: 'RestaurantTable',
          entityId: id,
          before: { label: table.label },
        });
        return { archived: true };
      }
      await tx.restaurantTable.delete({ where: { id } });
      await this.auditLog.logInTx(tx, {
        action: 'restaurant.table_deleted',
        entityType: 'RestaurantTable',
        entityId: id,
        before: { label: table.label },
      });
      return { archived: false };
    });
  }

  // ── Settings ───────────────────────────────────────────────────────────

  async getSettings(branchId: string) {
    const row = await this.tenantPrisma.run((tx) =>
      tx.restaurantSetting.findUnique({ where: { branchId } }),
    );
    return {
      branchId,
      reserveLeadMinutes:
        row?.reserveLeadMinutes ?? DEFAULT_RESERVE_LEAD_MINUTES,
    };
  }

  async saveSettings(dto: RestaurantSettingsDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.branch.findUnique({ where: { id: dto.branchId } })))
        throw new NotFoundException('Branch not found');
      const row = await tx.restaurantSetting.upsert({
        where: { branchId: dto.branchId },
        create: {
          organizationId,
          branchId: dto.branchId,
          reserveLeadMinutes: dto.reserveLeadMinutes,
        },
        update: { reserveLeadMinutes: dto.reserveLeadMinutes },
      });
      return {
        branchId: row.branchId,
        reserveLeadMinutes: row.reserveLeadMinutes,
      };
    });
  }
}
