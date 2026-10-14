import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { RentalBillingService } from './rental-billing.service';
import { fromCents, nairobiToday, toCents } from './rental-billing.util';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  BulkCreateUnitsDto,
  CreateLeaseDto,
  CreatePropertyDto,
  CreateTenantDto,
  CreateUnitDto,
  EndLeaseDto,
  UpdatePropertyDto,
  UpdateTenantDto,
  UpdateUnitDto,
} from './dto/rental.dto';

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class RentalService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly billing: RentalBillingService,
  ) {}

  // ── Properties ──────────────────────────────────────────────────────────

  async createProperty(dto: CreatePropertyDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run((tx) =>
        tx.rentalProperty.create({ data: { organizationId, ...dto } }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A property named "${dto.name}" already exists`,
        );
      }
      throw e;
    }
  }

  // Each property comes with its unit counts so the list can show occupancy without a second call.
  async listProperties() {
    const properties = await this.tenantPrisma.run((tx) =>
      tx.rentalProperty.findMany({
        orderBy: { name: 'asc' },
        include: { units: { select: { status: true, monthlyRent: true } } },
      }),
    );
    return properties.map(({ units, ...p }) => ({
      ...p,
      unitCount: units.length,
      occupiedCount: units.filter((u) => u.status === 'OCCUPIED').length,
    }));
  }

  async getProperty(id: string) {
    const property = await this.tenantPrisma.run((tx) =>
      tx.rentalProperty.findUnique({
        where: { id },
        include: {
          units: {
            orderBy: { label: 'asc' },
            include: {
              leases: {
                where: { status: 'ACTIVE' },
                include: { tenant: { select: { id: true, name: true, phone: true } } },
              },
            },
          },
        },
      }),
    );
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async updateProperty(id: string, dto: UpdatePropertyDto) {
    try {
      return await this.tenantPrisma.run(async (tx) => {
        if (!(await tx.rentalProperty.findUnique({ where: { id } }))) {
          throw new NotFoundException('Property not found');
        }
        return tx.rentalProperty.update({ where: { id }, data: dto });
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('Another property already has that name');
      }
      throw e;
    }
  }

  // ── Units ───────────────────────────────────────────────────────────────

  async createUnit(dto: CreateUnitDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run(async (tx) => {
        if (!(await tx.rentalProperty.findUnique({ where: { id: dto.propertyId } }))) {
          throw new NotFoundException('Property not found');
        }
        return tx.rentalUnit.create({ data: { organizationId, ...dto } });
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `This property already has a unit labelled "${dto.label}"`,
        );
      }
      throw e;
    }
  }

  // Adds many units to a property in one go. Labels the property already has (or repeats within the list) are skipped.
  async createUnitsBulk(dto: BulkCreateUnitsDto) {
    const { organizationId } = getTenantStore();
    const labels = [...new Set(dto.labels.map((l) => l.trim()).filter(Boolean))];
    if (labels.length === 0) {
      throw new BadRequestException('Give at least one unit name');
    }
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.rentalProperty.findUnique({ where: { id: dto.propertyId } }))) {
        throw new NotFoundException('Property not found');
      }
      const existing = await tx.rentalUnit.findMany({
        where: { propertyId: dto.propertyId, label: { in: labels } },
        select: { label: true },
      });
      const taken = new Set(existing.map((u) => u.label));
      const fresh = labels.filter((l) => !taken.has(l));
      if (fresh.length > 0) {
        await tx.rentalUnit.createMany({
          data: fresh.map((label) => ({
            organizationId,
            propertyId: dto.propertyId,
            label,
            monthlyRent: dto.monthlyRent,
            depositAmount: dto.depositAmount ?? 0,
          })),
          skipDuplicates: true,
        });
      }
      return { created: fresh.length, skipped: [...taken] };
    });
  }

  listUnits(filters: { propertyId?: string; status?: 'VACANT' | 'OCCUPIED' }) {
    return this.tenantPrisma.run((tx) =>
      tx.rentalUnit.findMany({
        where: { propertyId: filters.propertyId, status: filters.status },
        orderBy: [{ propertyId: 'asc' }, { label: 'asc' }],
        include: {
          property: { select: { id: true, name: true } },
          leases: {
            where: { status: 'ACTIVE' },
            select: { tenant: { select: { id: true, name: true } } },
          },
        },
      }),
    );
  }

  async updateUnit(id: string, dto: UpdateUnitDto) {
    try {
      return await this.tenantPrisma.run(async (tx) => {
        if (!(await tx.rentalUnit.findUnique({ where: { id } }))) {
          throw new NotFoundException('Unit not found');
        }
        return tx.rentalUnit.update({ where: { id }, data: dto });
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('This property already has a unit with that label');
      }
      throw e;
    }
  }

  // ── Tenants ─────────────────────────────────────────────────────────────

  // With a unitId the tenant is also moved into that vacant unit, all in one transaction.
  async createTenant(dto: CreateTenantDto) {
    const { organizationId } = getTenantStore();
    const { unitId, startDate, dueDay, monthlyRent, depositAmount, ...rest } = dto;
    const person = { ...rest, email: rest.email?.trim().toLowerCase() };
    if (unitId && !startDate) {
      throw new BadRequestException('Give a move-in date to put the tenant in a unit');
    }
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const tenant = await tx.rentalTenant.create({
          data: { organizationId, ...person },
        });
        if (!unitId || !startDate) return tenant;
        const lease = await this.createLeaseInTx(tx, organizationId, {
          unitId,
          tenantId: tenant.id,
          startDate,
          dueDay,
          monthlyRent,
          depositAmount,
        });
        return { ...tenant, lease };
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('This unit already has an active lease');
      }
      throw e;
    }
  }

  listTenants() {
    return this.tenantPrisma.run((tx) =>
      tx.rentalTenant.findMany({
        orderBy: { name: 'asc' },
        include: {
          leases: {
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              unit: { select: { label: true, property: { select: { name: true } } } },
            },
          },
        },
      }),
    );
  }

  async getTenant(id: string) {
    const tenant = await this.tenantPrisma.run((tx) =>
      tx.rentalTenant.findUnique({
        where: { id },
        include: {
          leases: {
            orderBy: { startDate: 'desc' },
            include: {
              unit: { select: { label: true, property: { select: { name: true } } } },
            },
          },
        },
      }),
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.rentalTenant.findUnique({ where: { id } }))) {
        throw new NotFoundException('Tenant not found');
      }
      return tx.rentalTenant.update({ where: { id }, data: { ...dto, email: dto.email?.trim().toLowerCase() } });
    });
  }

  // ── Leases ──────────────────────────────────────────────────────────────

  async createLease(dto: CreateLeaseDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run((tx) =>
        this.createLeaseInTx(tx, organizationId, dto),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('This unit already has an active lease');
      }
      throw e;
    }
  }

  private async createLeaseInTx(
    tx: Prisma.TransactionClient,
    organizationId: string,
    dto: CreateLeaseDto,
  ) {
    if (dto.endDate && new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('The end date must be after the start date');
    }
    const unit = await tx.rentalUnit.findUnique({ where: { id: dto.unitId } });
    if (!unit) throw new NotFoundException('Unit not found');
    if (!(await tx.rentalTenant.findUnique({ where: { id: dto.tenantId } }))) {
      throw new NotFoundException('Tenant not found');
    }
    // The partial unique index is the real guard against a race; this gives the friendly message.
    if (unit.status === 'OCCUPIED') {
      throw new ConflictException('This unit is already occupied. End its current lease first.');
    }

    const lease = await tx.rentalLease.create({
      data: {
        organizationId,
        unitId: dto.unitId,
        tenantId: dto.tenantId,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        monthlyRent: dto.monthlyRent ?? unit.monthlyRent,
        depositAmount: dto.depositAmount ?? unit.depositAmount,
        dueDay: dto.dueDay ?? 1,
      },
    });
    await tx.rentalUnit.update({
      where: { id: unit.id },
      data: { status: 'OCCUPIED' },
    });
    // Start billing straight away: the first month's rent and the deposit appear as invoices.
    await this.billing.syncLease(tx, organizationId, lease);
    return lease;
  }

  listLeases(filters: { status?: 'ACTIVE' | 'ENDED'; unitId?: string; tenantId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.rentalLease.findMany({
        where: filters,
        orderBy: { startDate: 'desc' },
        include: {
          tenant: { select: { id: true, name: true, phone: true } },
          unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } },
        },
      }),
    );
  }

  async endLease(id: string, dto: EndLeaseDto) {
    return this.tenantPrisma.run(async (tx) => {
      const lease = await tx.rentalLease.findUnique({ where: { id } });
      if (!lease) throw new NotFoundException('Lease not found');
      if (lease.status === 'ENDED') {
        throw new ConflictException('This lease has already ended');
      }
      const endedAt = dto.endedAt ? new Date(dto.endedAt) : nairobiToday();
      if (endedAt < lease.startDate) {
        throw new BadRequestException('A lease cannot end before it starts');
      }
      if (dto.depositRefunded) {
        const deposit = await tx.rentalInvoice.aggregate({
          where: { leaseId: id, kind: 'DEPOSIT' },
          _sum: { amountPaid: true },
        });
        if (toCents(dto.depositRefunded) > toCents(deposit._sum.amountPaid ?? 0)) {
          throw new BadRequestException(
            `You can refund at most the deposit the tenant paid (KES ${fromCents(toCents(deposit._sum.amountPaid ?? 0))})`,
          );
        }
      }
      const ended = await tx.rentalLease.update({
        where: { id },
        data: { status: 'ENDED', endedAt, depositRefunded: dto.depositRefunded ?? 0 },
      });
      await tx.rentalUnit.update({
        where: { id: lease.unitId },
        data: { status: 'VACANT' },
      });
      return ended;
    });
  }
}
