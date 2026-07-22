import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayType } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { SetPayrollProfileDto } from './dto/set-payroll-profile.dto';

const PROFILE_INCLUDE = {
  orgUser: { select: { id: true, role: true, user: { select: { fullName: true } } } },
} as const;

@Injectable()
export class PayrollProfilesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.payrollProfile.findMany({
        include: PROFILE_INCLUDE,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * Full upsert, not a patch - a small per-employee record a manager sets
   * as a whole, same reasoning as RecipesService.set(). Creating a profile
   * for an OrgUser is opt-in: an employee with none simply never appears
   * in a generated PayrollRun (see PayrollRunsService.generate()).
   */
  async set(orgUserId: string, dto: SetPayrollProfileDto) {
    if (dto.payType === PayType.SALARY && !dto.baseSalary) {
      throw new BadRequestException(
        'baseSalary is required for a SALARY pay type',
      );
    }
    if (dto.payType === PayType.HOURLY && !dto.hourlyRate) {
      throw new BadRequestException(
        'hourlyRate is required for an HOURLY pay type',
      );
    }

    return this.tenantPrisma.run(async (tx) => {
      const orgUser = await tx.orgUser.findUnique({ where: { id: orgUserId } });
      if (!orgUser) throw new NotFoundException('Org user not found');

      const { organizationId } = getTenantStore();
      const profile = await tx.payrollProfile.upsert({
        where: { orgUserId },
        create: {
          organizationId,
          orgUserId,
          payType: dto.payType,
          baseSalary: dto.payType === PayType.SALARY ? dto.baseSalary : null,
          hourlyRate: dto.payType === PayType.HOURLY ? dto.hourlyRate : null,
          kraPin: dto.kraPin,
          nssfNumber: dto.nssfNumber,
          shifNumber: dto.shifNumber,
        },
        update: {
          payType: dto.payType,
          baseSalary: dto.payType === PayType.SALARY ? dto.baseSalary : null,
          hourlyRate: dto.payType === PayType.HOURLY ? dto.hourlyRate : null,
          kraPin: dto.kraPin,
          nssfNumber: dto.nssfNumber,
          shifNumber: dto.shifNumber,
          active: true,
        },
        include: PROFILE_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'payrollProfile.set',
        entityType: 'PayrollProfile',
        entityId: profile.id,
        after: { orgUserId, payType: dto.payType },
      });

      return profile;
    });
  }

  async deactivate(orgUserId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const profile = await tx.payrollProfile.findUnique({ where: { orgUserId } });
      if (!profile) throw new NotFoundException('Payroll profile not found');

      const updated = await tx.payrollProfile.update({
        where: { orgUserId },
        data: { active: false },
        include: PROFILE_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'payrollProfile.deactivated',
        entityType: 'PayrollProfile',
        entityId: profile.id,
      });

      return updated;
    });
  }
}
