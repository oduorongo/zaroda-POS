import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollRunStatus, PayType } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { calculateStatutoryDeductions } from '../common/payroll/kenya-statutory.util';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';

const RUN_INCLUDE = {
  payslips: {
    include: {
      orgUser: { select: { id: true, user: { select: { fullName: true } } } },
    },
  },
} as const;

@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreatePayrollRunDto) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd <= periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }

    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      const run = await tx.payrollRun.create({
        data: { organizationId, periodStart, periodEnd, createdById: orgUserId },
        include: RUN_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'payrollRun.created',
        entityType: 'PayrollRun',
        entityId: run.id,
        after: { periodStart, periodEnd },
      });

      return run;
    });
  }

  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.payrollRun.findMany({
        include: RUN_INCLUDE,
        orderBy: { periodStart: 'desc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const run = await this.tenantPrisma.run((tx) =>
      tx.payrollRun.findUnique({ where: { id }, include: RUN_INCLUDE }),
    );
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  /**
   * Computes every active PayrollProfile's payslip for this run's period
   * and (re)writes them - safe to call more than once on a still-DRAFT
   * run (e.g. after fixing an employee's rate), since payslips are wiped
   * and regenerated rather than accumulated. Once APPROVED or PAID, a run
   * is frozen - regenerating would silently change numbers someone has
   * already signed off on or paid out against.
   *
   * HOURLY pay is computed from CashierSession - the actual PIN-in/PIN-out
   * record already kept for shared-terminal attribution (see schema.prisma's
   * comment on CashierSession), not a separate timesheet: only sessions
   * that have actually ended (pinEndedAt set) within [periodStart,
   * periodEnd) count, so a still-open session never gets paid for hours
   * that haven't happened yet.
   */
  async generate(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot regenerate a payroll run that is already ${run.status.toLowerCase()}`,
        );
      }

      const profiles = await tx.payrollProfile.findMany({
        where: { active: true },
      });

      await tx.payslip.deleteMany({ where: { payrollRunId: id } });

      for (const profile of profiles) {
        let grossPay: number;
        let hoursWorked: number | null = null;

        if (profile.payType === PayType.SALARY) {
          grossPay = Number(profile.baseSalary);
        } else {
          const sessions = await tx.cashierSession.findMany({
            where: {
              orgUserId: profile.orgUserId,
              pinStartedAt: { gte: run.periodStart, lt: run.periodEnd },
              pinEndedAt: { not: null },
            },
          });
          hoursWorked = sessions.reduce((sum, s) => {
            const ms = s.pinEndedAt!.getTime() - s.pinStartedAt.getTime();
            return sum + ms / 3_600_000;
          }, 0);
          grossPay = hoursWorked * Number(profile.hourlyRate);
        }

        const deductions = calculateStatutoryDeductions(grossPay);

        await tx.payslip.create({
          data: {
            payrollRunId: id,
            orgUserId: profile.orgUserId,
            payType: profile.payType,
            hoursWorked,
            grossPay,
            payeTax: deductions.payeTax,
            nssfDeduction: deductions.nssfDeduction,
            shifDeduction: deductions.shifDeduction,
            housingLevy: deductions.housingLevy,
            totalDeductions: deductions.totalDeductions,
            netPay: deductions.netPay,
          },
        });
      }

      await this.auditLog.logInTx(tx, {
        action: 'payrollRun.generated',
        entityType: 'PayrollRun',
        entityId: id,
        after: { employeeCount: profiles.length },
      });

      return tx.payrollRun.findUnique({ where: { id }, include: RUN_INCLUDE });
    });
  }

  async approve(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const run = await tx.payrollRun.findUnique({
        where: { id },
        include: { payslips: true },
      });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot approve a payroll run that is already ${run.status.toLowerCase()}`,
        );
      }
      if (run.payslips.length === 0) {
        throw new BadRequestException(
          'Generate payslips for this run before approving it',
        );
      }

      const { orgUserId } = getTenantStore();
      const updated = await tx.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.APPROVED,
          approvedById: orgUserId,
          approvedAt: new Date(),
        },
        include: RUN_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'payrollRun.approved',
        entityType: 'PayrollRun',
        entityId: id,
      });

      return updated;
    });
  }

  async markPaid(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new BadRequestException(
          `Cannot mark a payroll run paid unless it is approved - it is currently ${run.status.toLowerCase()}`,
        );
      }

      const updated = await tx.payrollRun.update({
        where: { id },
        data: { status: PayrollRunStatus.PAID, paidAt: new Date() },
        include: RUN_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'payrollRun.paid',
        entityType: 'PayrollRun',
        entityId: id,
      });

      return updated;
    });
  }
}
