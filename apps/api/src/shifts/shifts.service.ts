import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SaleStatus } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

export interface ShiftReport {
  shiftId: string;
  openedAt: Date;
  closedAt: Date | null;
  openingFloat: number;
  saleCount: number;
  voidedCount: number;
  totalSales: number;
  paymentsByMethod: Record<string, number>;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async open(dto: OpenShiftDto) {
    return this.tenantPrisma.run(async (tx) => {
      const [branch, terminal] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.terminal.findUnique({ where: { id: dto.terminalId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!terminal) throw new NotFoundException('Terminal not found');

      const alreadyOpen = await tx.shift.findFirst({
        where: { terminalId: dto.terminalId, closedAt: null },
      });
      if (alreadyOpen) {
        throw new ConflictException(
          `Terminal already has an open shift (${alreadyOpen.id}) - close it before opening a new one`,
        );
      }

      const { orgUserId } = getTenantStore();
      const shift = await tx.shift.create({
        data: {
          branchId: dto.branchId,
          terminalId: dto.terminalId,
          openedById: orgUserId,
          openingFloat: dto.openingFloat,
        },
      });

      await this.auditLog.logInTx(tx, {
        action: 'shift.opened',
        entityType: 'Shift',
        entityId: shift.id,
        after: { openingFloat: dto.openingFloat },
        terminalId: dto.terminalId,
      });

      return shift;
    });
  }

  findAll(filters: { branchId?: string; terminalId?: string; open?: boolean }) {
    return this.tenantPrisma.run((tx) =>
      tx.shift.findMany({
        where: {
          branchId: filters.branchId,
          terminalId: filters.terminalId,
          ...(filters.open !== undefined
            ? { closedAt: filters.open ? null : { not: null } }
            : {}),
        },
        orderBy: { openedAt: 'desc' },
        take: 200,
      }),
    );
  }

  private async computeReport(
    tx: TenantTx,
    shiftId: string,
  ): Promise<ShiftReport> {
    const shift = await tx.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundException('Shift not found');

    const sales = await tx.sale.findMany({
      where: { shiftId },
      include: { payments: true },
    });
    const completed = sales.filter((s) => s.status === SaleStatus.COMPLETED);
    const voided = sales.filter((s) => s.status === SaleStatus.VOIDED);

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const paymentsByMethod: Record<string, number> = {};
    for (const sale of completed) {
      for (const payment of sale.payments) {
        const amount = Number(payment.amount);
        paymentsByMethod[payment.method] = round2(
          (paymentsByMethod[payment.method] ?? 0) + amount,
        );
      }
    }

    const totalSales = round2(
      completed.reduce((sum, s) => sum + Number(s.total), 0),
    );
    const cashSalesTotal = paymentsByMethod['CASH'] ?? 0;
    const expectedCash = round2(Number(shift.openingFloat) + cashSalesTotal);

    return {
      shiftId: shift.id,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      openingFloat: Number(shift.openingFloat),
      saleCount: completed.length,
      voidedCount: voided.length,
      totalSales,
      paymentsByMethod,
      expectedCash,
      countedCash:
        shift.countedCash === null ? null : Number(shift.countedCash),
      variance: shift.variance === null ? null : Number(shift.variance),
    };
  }

  /** X-report: a live snapshot, works whether the shift is open or already closed - never mutates anything. */
  report(shiftId: string) {
    return this.tenantPrisma.run((tx) => this.computeReport(tx, shiftId));
  }

  /**
   * Z-report: closes the shift, recording what was actually counted against
   * what the sales ledger says should be in the drawer. `variance` is
   * informational, not corrective - a mismatch is normal (till float
   * errors, unrecorded paid-outs) and gets reconciled by a manager
   * afterwards, not blocked at close time.
   */
  async close(shiftId: string, dto: CloseShiftDto) {
    return this.tenantPrisma.run(async (tx) => {
      const shift = await tx.shift.findUnique({ where: { id: shiftId } });
      if (!shift) throw new NotFoundException('Shift not found');
      if (shift.closedAt)
        throw new BadRequestException('This shift is already closed');

      const report = await this.computeReport(tx, shiftId);
      // Rounded to the cent - plain JS float subtraction (680 - 685.6)
      // produces things like -5.600000000000023, which is fine for the
      // Decimal column (Postgres stores it exactly) but looks broken
      // surfaced back in the same response's JSON report.
      const variance =
        Math.round((dto.countedCash - report.expectedCash) * 100) / 100;

      const updated = await tx.shift.update({
        where: { id: shiftId },
        data: { closedAt: new Date(), countedCash: dto.countedCash, variance },
      });

      await this.auditLog.logInTx(tx, {
        action: 'shift.closed',
        entityType: 'Shift',
        entityId: shiftId,
        before: { closedAt: null },
        after: {
          countedCash: dto.countedCash,
          expectedCash: report.expectedCash,
          variance,
        },
      });

      return {
        ...updated,
        report: { ...report, countedCash: dto.countedCash, variance },
      };
    });
  }
}
