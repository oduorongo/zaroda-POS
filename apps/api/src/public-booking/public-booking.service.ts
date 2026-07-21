import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { assertNoOverlap } from '../salon/salon-overlap.util';
import { PublicBookAppointmentDto } from './dto/public-book-appointment.dto';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };

/**
 * The one place in this API that accepts a tenant identity
 * (organizationId, via the URL, not a JWT) directly from an
 * unauthenticated caller - a genuinely different trust model from
 * everywhere else in this codebase, where organizationId always comes
 * from a validated token (AuthService.login/pinLogin/register) or,
 * for the platform-admin module, from an identity that's itself
 * authenticated and audited. Kept deliberately narrow because of that:
 * - Read access is limited to resource names and busy time blocks -
 *   never another customer's name, phone, or the service they booked
 *   (see getAvailability's comment on why).
 * - The only write is creating a SCHEDULED appointment - no status
 *   changes, no cancellation, nothing that could be used to grief an
 *   existing booking.
 * - Every write is throttled at the controller (same reasoning as
 *   auth.controller.ts's login/register throttling: an unauthenticated
 *   endpoint that writes is worth rate-limiting at least as much as one
 *   that only reads).
 */
@Injectable()
export class PublicBookingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Establishes tenant context for one transaction the same
   * set_config-in-a-raw-transaction pattern AuthService.pinLogin and
   * AuthService.register already use for the same underlying reason
   * (no JWT-derived tenant exists yet) - then validates branchId
   * actually belongs to organizationId before running the caller's
   * query, so a mismatched pair 404s cleanly instead of silently
   * returning nothing or querying across a tenant boundary the URL
   * didn't actually establish.
   */
  private async runForBranch<T>(
    organizationId: string,
    branchId: string,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      const branch = await tx.branch.findUnique({ where: { id: branchId } });
      if (!branch) throw new NotFoundException('Branch not found');
      return fn(tx);
    }, TX_OPTIONS);
  }

  listResources(organizationId: string, branchId: string) {
    return this.runForBranch(organizationId, branchId, (tx) =>
      tx.salonResource.findMany({
        where: { branchId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  /**
   * Busy blocks only - start/end time, nothing else. A public caller
   * needs to see when a resource is free, not who booked it or for
   * what (that's exactly the kind of customer/business detail
   * GET /salon/appointments - staff-only - exists to show instead).
   */
  async getAvailability(
    organizationId: string,
    branchId: string,
    resourceId: string,
    date: string,
  ) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);
    if (Number.isNaN(startOfDay.getTime())) {
      throw new BadRequestException('date must be an ISO date (YYYY-MM-DD)');
    }

    return this.runForBranch(organizationId, branchId, async (tx) => {
      const resource = await tx.salonResource.findUnique({
        where: { id: resourceId },
      });
      if (!resource || resource.branchId !== branchId) {
        throw new NotFoundException('Resource not found at this branch');
      }

      const appointments = await tx.salonAppointment.findMany({
        where: {
          resourceId,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startTime: { lte: endOfDay },
          endTime: { gte: startOfDay },
        },
        select: { startTime: true, endTime: true },
        orderBy: { startTime: 'asc' },
      });
      return appointments;
    });
  }

  /**
   * Finds-or-creates the Customer by phone within this org (the same
   * pattern OrgUsersService.create() uses for finding-or-creating a
   * User by email) - a returning customer's booking history/loyalty
   * points stay attached to one Customer row rather than a fresh one
   * per booking.
   */
  async bookAppointment(
    organizationId: string,
    branchId: string,
    dto: PublicBookAppointmentDto,
  ) {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    if (endTime <= startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }
    if (startTime.getTime() < Date.now() - 60_000) {
      throw new BadRequestException('startTime must be in the future');
    }

    return this.runForBranch(organizationId, branchId, async (tx) => {
      const resource = await tx.salonResource.findUnique({
        where: { id: dto.resourceId },
      });
      if (!resource || resource.branchId !== branchId) {
        throw new NotFoundException('Resource not found at this branch');
      }

      await assertNoOverlap(
        tx,
        dto.resourceId,
        resource.name,
        startTime,
        endTime,
      );

      const customer =
        (await tx.customer.findUnique({
          where: {
            organizationId_phone: { organizationId, phone: dto.customerPhone },
          },
        })) ??
        (await tx.customer.create({
          data: {
            organizationId,
            name: dto.customerName,
            phone: dto.customerPhone,
          },
        }));

      return tx.salonAppointment.create({
        data: {
          organizationId,
          branchId,
          resourceId: dto.resourceId,
          customerId: customer.id,
          serviceName: dto.serviceName,
          startTime,
          endTime,
        },
        select: {
          id: true,
          serviceName: true,
          startTime: true,
          endTime: true,
          status: true,
          resource: { select: { name: true } },
        },
      });
    });
  }
}
