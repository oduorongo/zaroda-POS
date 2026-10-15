import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { assertInScope, caretakerPropertyIds, propertyFilter } from './rental-caretaker-scope';
import { RentalBillingService } from './rental-billing.service';
import { fromCents, nairobiToday, toCents } from './rental-billing.util';
import {
  CreateExpenseDto,
  CreateMaintenanceDto,
  RecordMeterReadingDto,
  UpdateMaintenanceDto,
} from './dto/rental-ops.dto';

const KIND_LABEL = { WATER: 'Water', ELECTRICITY: 'Electricity' } as const;

/** Expenses, maintenance requests and meter readings - the day-to-day running of the properties. */
@Injectable()
export class RentalOpsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly billing: RentalBillingService,
  ) {}

  // ── Expenses ────────────────────────────────────────────────────────────

  async createExpense(dto: CreateExpenseDto) {
    const { organizationId } = getTenantStore();
    const incurredAt = dto.incurredAt ? new Date(dto.incurredAt) : nairobiToday();
    if (incurredAt > nairobiToday()) throw new BadRequestException('An expense cannot be dated in the future');
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.rentalProperty.findUnique({ where: { id: dto.propertyId } }))) throw new NotFoundException('Property not found');
      if (dto.unitId) {
        const unit = await tx.rentalUnit.findUnique({ where: { id: dto.unitId } });
        if (!unit || unit.propertyId !== dto.propertyId) throw new BadRequestException('That unit is not in this property');
      }
      if (dto.maintenanceId && !(await tx.rentalMaintenanceRequest.findUnique({ where: { id: dto.maintenanceId } }))) {
        throw new NotFoundException('Maintenance request not found');
      }
      return tx.rentalExpense.create({
        data: {
          organizationId,
          propertyId: dto.propertyId,
          unitId: dto.unitId ?? null,
          maintenanceId: dto.maintenanceId ?? null,
          category: dto.category,
          description: dto.description.trim(),
          vendor: dto.vendor?.trim() || null,
          amount: dto.amount,
          incurredAt,
        },
      });
    });
  }

  async listExpenses(filters: { propertyId?: string; from?: string; to?: string }) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.rentalExpense.findMany({
        where: {
          propertyId: filters.propertyId,
          incurredAt: { gte: filters.from ? new Date(filters.from) : undefined, lte: filters.to ? new Date(filters.to) : undefined },
        },
        orderBy: [{ incurredAt: 'desc' }, { createdAt: 'desc' }],
        take: 500,
        include: { property: { select: { name: true } }, unit: { select: { label: true } } },
      }),
    );
    return rows.map((e) => ({
      id: e.id,
      property: e.property.name,
      unit: e.unit?.label ?? null,
      category: e.category,
      description: e.description,
      vendor: e.vendor,
      amount: Number(e.amount),
      incurredAt: e.incurredAt,
    }));
  }

  async deleteExpense(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.rentalExpense.findUnique({ where: { id } }))) throw new NotFoundException('Expense not found');
      await tx.rentalExpense.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // ── Maintenance ─────────────────────────────────────────────────────────

  async createMaintenance(dto: CreateMaintenanceDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      assertInScope(await caretakerPropertyIds(tx), dto.propertyId, 'Property');
      if (!(await tx.rentalProperty.findUnique({ where: { id: dto.propertyId } }))) throw new NotFoundException('Property not found');
      if (dto.unitId) {
        const unit = await tx.rentalUnit.findUnique({ where: { id: dto.unitId } });
        if (!unit || unit.propertyId !== dto.propertyId) throw new BadRequestException('That unit is not in this property');
      }
      if (dto.tenantId && !(await tx.rentalTenant.findUnique({ where: { id: dto.tenantId } }))) throw new NotFoundException('Tenant not found');
      return tx.rentalMaintenanceRequest.create({
        data: {
          organizationId,
          propertyId: dto.propertyId,
          unitId: dto.unitId ?? null,
          tenantId: dto.tenantId ?? null,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          priority: dto.priority ?? 'NORMAL',
          reportedAt: nairobiToday(),
        },
      });
    });
  }

  async listMaintenance(filters: { status?: string; propertyId?: string }) {
    const rows = await this.tenantPrisma.run(async (tx) =>
      tx.rentalMaintenanceRequest.findMany({
        where: {
          propertyId: propertyFilter(await caretakerPropertyIds(tx), filters.propertyId),
          status: filters.status ? (filters.status as 'OPEN') : undefined,
        },
        orderBy: [{ reportedAt: 'desc' }, { createdAt: 'desc' }],
        take: 300,
        include: {
          property: { select: { name: true } },
          unit: { select: { label: true } },
          tenant: { select: { name: true } },
          expenses: { select: { amount: true } },
        },
      }),
    );
    return rows.map((m) => ({
      id: m.id,
      property: m.property.name,
      propertyId: m.propertyId,
      unit: m.unit?.label ?? null,
      unitId: m.unitId,
      reportedBy: m.tenant?.name ?? null,
      title: m.title,
      description: m.description,
      priority: m.priority,
      status: m.status,
      reportedAt: m.reportedAt,
      resolvedAt: m.resolvedAt,
      cost: fromCents(m.expenses.reduce((s, e) => s + toCents(e.amount), 0)),
    }));
  }

  async updateMaintenance(id: string, dto: UpdateMaintenanceDto) {
    return this.tenantPrisma.run(async (tx) => {
      const current = await tx.rentalMaintenanceRequest.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Request not found');
      assertInScope(await caretakerPropertyIds(tx), current.propertyId, 'Request');
      const closing = dto.status === 'DONE' || dto.status === 'CANCELLED';
      return tx.rentalMaintenanceRequest.update({
        where: { id },
        data: {
          ...dto,
          // Reopening clears the resolved date; closing stamps it once.
          resolvedAt: dto.status === undefined ? undefined : closing ? current.resolvedAt ?? nairobiToday() : null,
        },
      });
    });
  }

  // ── Meter readings ──────────────────────────────────────────────────────

  /**
   * Records a water or electricity reading and, if the unit has a tenant, bills the consumption since the previous
   * reading as a one-off charge. The first reading of a meter has nothing to compare with, so it is just the starting
   * point (unless the landlord gives the previous reading, to bill the first month too).
   */
  async recordReading(dto: RecordMeterReadingDto) {
    const { organizationId } = getTenantStore();
    const readingDate = dto.readingDate ? new Date(dto.readingDate) : nairobiToday();
    if (readingDate > nairobiToday()) throw new BadRequestException('A reading cannot be dated in the future');
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const unit = await tx.rentalUnit.findUnique({ where: { id: dto.unitId }, include: { property: { select: { name: true } } } });
        if (!unit) throw new NotFoundException('Unit not found');
        assertInScope(await caretakerPropertyIds(tx), unit.propertyId, 'Unit');

        const previous = await tx.rentalMeterReading.findFirst({
          where: { unitId: unit.id, kind: dto.kind, readingDate: { lt: readingDate } },
          orderBy: { readingDate: 'desc' },
        });
        const later = await tx.rentalMeterReading.findFirst({ where: { unitId: unit.id, kind: dto.kind, readingDate: { gt: readingDate } } });
        if (later) throw new BadRequestException('There is already a later reading for this meter - enter readings in date order');

        const prevValue = previous ? Number(previous.reading) : dto.previousReading;
        if (prevValue !== undefined && toCents(dto.reading) < toCents(prevValue)) {
          throw new BadRequestException(`The new reading (${dto.reading}) is lower than the previous one (${prevValue}) - check the meter`);
        }
        const rate = dto.ratePerUnit ?? (previous?.ratePerUnit ? Number(previous.ratePerUnit) : undefined);
        const used = prevValue === undefined ? null : fromCents(toCents(dto.reading) - toCents(prevValue));

        const lease = await tx.rentalLease.findFirst({ where: { unitId: unit.id, status: 'ACTIVE' } });

        let invoiceId: string | null = null;
        let charge = 0;
        if (used !== null && used > 0 && rate && rate > 0 && lease) {
          charge = Math.round(used * rate * 100) / 100;
          if (charge > 0) {
            const invoice = await tx.rentalInvoice.create({
              data: {
                organizationId,
                leaseId: lease.id,
                kind: 'OTHER',
                description: `${KIND_LABEL[dto.kind]}: ${used} units at KES ${rate} (${prevValue} to ${dto.reading})`,
                amountDue: charge,
                dueDate: nairobiToday(),
              },
            });
            invoiceId = invoice.id;
            await this.billing.applyCredit(tx, organizationId, lease.id);
          }
        }

        const saved = await tx.rentalMeterReading.create({
          data: {
            organizationId,
            unitId: unit.id,
            leaseId: lease?.id ?? null,
            kind: dto.kind,
            readingDate,
            reading: dto.reading,
            previousReading: prevValue ?? null,
            unitsUsed: used,
            ratePerUnit: rate ?? null,
            chargeInvoiceId: invoiceId,
          },
        });
        return {
          id: saved.id,
          unit: `${unit.property.name} ${unit.label}`,
          kind: dto.kind,
          reading: dto.reading,
          unitsUsed: used,
          charged: charge,
          billedToTenant: invoiceId !== null,
          note:
            used === null
              ? 'Starting reading saved. The next reading will be billed from this one.'
              : !lease
                ? 'Saved, but the unit has no tenant so nothing was billed.'
                : !rate
                  ? 'Saved, but no rate was given so nothing was billed.'
                  : undefined,
        };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This meter already has a reading for that date');
      }
      throw e;
    }
  }

  async listReadings(filters: { unitId?: string }) {
    const rows = await this.tenantPrisma.run(async (tx) => {
      const scope = await caretakerPropertyIds(tx);
      return tx.rentalMeterReading.findMany({
        where: { unitId: filters.unitId, ...(scope ? { unit: { propertyId: { in: scope } } } : {}) },
        orderBy: [{ readingDate: 'desc' }, { createdAt: 'desc' }],
        take: 300,
        include: { unit: { select: { label: true, property: { select: { name: true } } } } },
      });
    });
    return rows.map((r) => ({
      id: r.id,
      unit: `${r.unit.property.name} ${r.unit.label}`,
      unitId: r.unitId,
      kind: r.kind,
      readingDate: r.readingDate,
      reading: Number(r.reading),
      unitsUsed: r.unitsUsed === null ? null : Number(r.unitsUsed),
      ratePerUnit: r.ratePerUnit === null ? null : Number(r.ratePerUnit),
      charged: r.unitsUsed !== null && r.ratePerUnit !== null && r.chargeInvoiceId ? Math.round(Number(r.unitsUsed) * Number(r.ratePerUnit) * 100) / 100 : 0,
    }));
  }
}
