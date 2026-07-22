import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateRosterShiftDto } from './dto/create-roster-shift.dto';
import { UpdateRosterShiftDto } from './dto/update-roster-shift.dto';
import { ListRosterShiftsDto } from './dto/list-roster-shifts.dto';

const SHIFT_INCLUDE = {
  orgUser: { select: { id: true, user: { select: { fullName: true } } } },
  branch: { select: { name: true } },
} as const;

/**
 * A rostered staff member can't be double-booked onto two overlapping
 * shifts, same reasoning as salon-overlap.util.ts's assertNoOverlap for a
 * bookable resource - just scoped to orgUserId instead of a salon
 * resourceId, and not extracted into a shared util since the two check
 * different tables with no common shape to factor out.
 */
async function assertNoOverlap(
  tx: TenantTx,
  orgUserId: string,
  startTime: Date,
  endTime: Date,
  excludeId?: string,
) {
  const overlapping = await tx.rosterShift.findFirst({
    where: {
      orgUserId,
      id: excludeId ? { not: excludeId } : undefined,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
  });
  if (overlapping) {
    throw new BadRequestException(
      `This staff member is already rostered from ${overlapping.startTime.toISOString()} to ${overlapping.endTime.toISOString()}`,
    );
  }
}

@Injectable()
export class RosterService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateRosterShiftDto) {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (endTime <= startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }

    return this.tenantPrisma.run(async (tx) => {
      const [branch, orgUser] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.orgUser.findUnique({ where: { id: dto.orgUserId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!orgUser) throw new NotFoundException('Org user not found');

      await assertNoOverlap(tx, dto.orgUserId, startTime, endTime);

      const { organizationId, orgUserId: createdById } = getTenantStore();
      const shift = await tx.rosterShift.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          orgUserId: dto.orgUserId,
          startTime,
          endTime,
          notes: dto.notes,
          createdById,
        },
        include: SHIFT_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'rosterShift.created',
        entityType: 'RosterShift',
        entityId: shift.id,
        after: { orgUserId: dto.orgUserId, branchId: dto.branchId, startTime, endTime },
      });

      return shift;
    });
  }

  findAll(filters: ListRosterShiftsDto) {
    return this.tenantPrisma.run((tx) =>
      tx.rosterShift.findMany({
        where: {
          branchId: filters.branchId,
          orgUserId: filters.orgUserId,
          published: filters.publishedOnly === 'true' ? true : undefined,
          startTime: filters.from ? { gte: new Date(filters.from) } : undefined,
          endTime: filters.to ? { lte: new Date(filters.to) } : undefined,
        },
        include: SHIFT_INCLUDE,
        orderBy: { startTime: 'asc' },
        take: 500,
      }),
    );
  }

  async update(id: string, dto: UpdateRosterShiftDto) {
    return this.tenantPrisma.run(async (tx) => {
      const shift = await tx.rosterShift.findUnique({ where: { id } });
      if (!shift) throw new NotFoundException('Roster shift not found');

      const startTime = dto.startTime ? new Date(dto.startTime) : shift.startTime;
      const endTime = dto.endTime ? new Date(dto.endTime) : shift.endTime;
      if (endTime <= startTime) {
        throw new BadRequestException('endTime must be after startTime');
      }
      if (dto.startTime || dto.endTime) {
        await assertNoOverlap(tx, shift.orgUserId, startTime, endTime, id);
      }

      return tx.rosterShift.update({
        where: { id },
        data: { startTime, endTime, notes: dto.notes ?? shift.notes },
        include: SHIFT_INCLUDE,
      });
    });
  }

  async setPublished(id: string, published: boolean) {
    return this.tenantPrisma.run(async (tx) => {
      const shift = await tx.rosterShift.findUnique({ where: { id } });
      if (!shift) throw new NotFoundException('Roster shift not found');

      const updated = await tx.rosterShift.update({
        where: { id },
        data: { published },
        include: SHIFT_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: published ? 'rosterShift.published' : 'rosterShift.unpublished',
        entityType: 'RosterShift',
        entityId: id,
      });

      return updated;
    });
  }

  async remove(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const shift = await tx.rosterShift.findUnique({ where: { id } });
      if (!shift) throw new NotFoundException('Roster shift not found');

      await tx.rosterShift.delete({ where: { id } });

      await this.auditLog.logInTx(tx, {
        action: 'rosterShift.deleted',
        entityType: 'RosterShift',
        entityId: id,
      });

      return { ok: true };
    });
  }
}
