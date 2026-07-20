import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SalonAppointmentStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';

const APPOINTMENT_INCLUDE = { resource: true, customer: true } as const;

// Not a strict single-path sequence like the restaurant module's kitchen
// tickets - a salon appointment can branch to CANCELLED or NO_SHOW from
// either of the two "not yet happened" states, not just advance linearly.
// COMPLETED/CANCELLED/NO_SHOW are all terminal - nothing transitions out
// of them.
const ALLOWED_TRANSITIONS: Record<
  SalonAppointmentStatus,
  SalonAppointmentStatus[]
> = {
  [SalonAppointmentStatus.SCHEDULED]: [
    SalonAppointmentStatus.CONFIRMED,
    SalonAppointmentStatus.CANCELLED,
    SalonAppointmentStatus.NO_SHOW,
  ],
  [SalonAppointmentStatus.CONFIRMED]: [
    SalonAppointmentStatus.IN_PROGRESS,
    SalonAppointmentStatus.CANCELLED,
    SalonAppointmentStatus.NO_SHOW,
  ],
  [SalonAppointmentStatus.IN_PROGRESS]: [SalonAppointmentStatus.COMPLETED],
  [SalonAppointmentStatus.COMPLETED]: [],
  [SalonAppointmentStatus.CANCELLED]: [],
  [SalonAppointmentStatus.NO_SHOW]: [],
};

@Injectable()
export class SalonAppointmentsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /**
   * The actual "resource scheduling" value this module exists for: two
   * appointments for the same resource with overlapping time ranges is
   * rejected outright, not left for a human to notice at checkout. A
   * cancelled/no-show appointment doesn't block the slot it was going to
   * occupy - the resource is genuinely free again once an appointment is
   * no longer actually happening.
   */
  async create(dto: CreateAppointmentDto) {
    const { organizationId } = getTenantStore();
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (endTime <= startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }

    return this.tenantPrisma.run(async (tx) => {
      const [branch, resource] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.salonResource.findUnique({ where: { id: dto.resourceId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!resource) throw new NotFoundException('Resource not found');

      const overlapping = await tx.salonAppointment.findFirst({
        where: {
          resourceId: dto.resourceId,
          status: {
            notIn: [
              SalonAppointmentStatus.CANCELLED,
              SalonAppointmentStatus.NO_SHOW,
            ],
          },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });
      if (overlapping) {
        throw new BadRequestException(
          `${resource.name} is already booked from ${overlapping.startTime.toISOString()} to ${overlapping.endTime.toISOString()}`,
        );
      }

      return tx.salonAppointment.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          resourceId: dto.resourceId,
          customerId: dto.customerId,
          serviceName: dto.serviceName,
          startTime,
          endTime,
          notes: dto.notes,
        },
        include: APPOINTMENT_INCLUDE,
      });
    });
  }

  findAll(filters: ListAppointmentsDto) {
    return this.tenantPrisma.run((tx) =>
      tx.salonAppointment.findMany({
        where: {
          branchId: filters.branchId,
          resourceId: filters.resourceId,
          status: filters.status,
          startTime: filters.from ? { gte: new Date(filters.from) } : undefined,
          endTime: filters.to ? { lte: new Date(filters.to) } : undefined,
        },
        include: APPOINTMENT_INCLUDE,
        orderBy: { startTime: 'asc' },
        take: 200,
      }),
    );
  }

  async updateStatus(id: string, dto: UpdateAppointmentStatusDto) {
    return this.tenantPrisma.run(async (tx) => {
      const appointment = await tx.salonAppointment.findUnique({
        where: { id },
      });
      if (!appointment) throw new NotFoundException('Appointment not found');

      const allowed = ALLOWED_TRANSITIONS[appointment.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot move an appointment from ${appointment.status} to ${dto.status}`,
        );
      }

      return tx.salonAppointment.update({
        where: { id },
        data: { status: dto.status },
        include: APPOINTMENT_INCLUDE,
      });
    });
  }
}
