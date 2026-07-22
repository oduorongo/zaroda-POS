import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { NotificationsQueueService } from '../queue/notifications-queue.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsQueue: NotificationsQueueService,
    private readonly config: ConfigService,
  ) {}

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

    const { appointment, isNew } = await this.runForBranch(
      organizationId,
      branchId,
      async (tx) => {
        // Idempotent on clientId (DESIGN.md §6) - same reasoning as the
        // staff-facing SalonAppointmentsService.create(), doubly important
        // here since a public, unauthenticated caller (a customer's own
        // browser retrying after a flaky connection) has no other recourse
        // if a retry hit assertNoOverlap and errored instead of returning
        // their actual booking. isNew gates the SMS resend below - a retry
        // must not re-text the customer a second confirmation.
        const existing = await tx.salonAppointment.findUnique({
          where: { clientId: dto.clientId },
          select: {
            id: true,
            serviceName: true,
            startTime: true,
            endTime: true,
            status: true,
            cancelToken: true,
            resource: { select: { name: true } },
          },
        });
        if (existing) return { appointment: existing, isNew: false };

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
              organizationId_phone: {
                organizationId,
                phone: dto.customerPhone,
              },
            },
          })) ??
          (await tx.customer.create({
            data: {
              organizationId,
              name: dto.customerName,
              phone: dto.customerPhone,
            },
          }));

        const created = await tx.salonAppointment.create({
          data: {
            organizationId,
            branchId,
            resourceId: dto.resourceId,
            customerId: customer.id,
            serviceName: dto.serviceName,
            startTime,
            endTime,
            clientId: dto.clientId,
          },
          // cancelToken IS returned here, and only here - this is the one
          // moment the customer who just created this booking legitimately
          // learns it, the same way a password-reset flow shows a token
          // exactly once, at generation. Every other read below requires
          // the token as an input, never returns it again.
          select: {
            id: true,
            serviceName: true,
            startTime: true,
            endTime: true,
            status: true,
            cancelToken: true,
            resource: { select: { name: true } },
          },
        });
        return { appointment: created, isNew: true };
      },
    );

    // Enqueued AFTER the transaction above has committed, never inside it
    // - a network call (even just enqueuing to Redis) held open inside a
    // DB transaction is exactly the kind of thing this project's own
    // load-testing history (see the README) already found compounds
    // Neon's connection-pool pressure. The actual Africa's Talking send
    // now happens in the worker process (queue/notifications.processor.ts),
    // not here - `notified` reflects "queued for delivery", not "delivery
    // confirmed" (it never meant the latter even before this moved to a
    // queue - AfricasTalkingSmsProvider's own synchronous call was only
    // ever "the provider's API accepted it," not "the phone received it").
    // Never queued for an idempotent replay (isNew false) - same reasoning
    // as Sale.create() gating sale.afterComplete.
    const manageBaseUrl = this.config.get<string>('PUBLIC_BOOKING_BASE_URL');
    let notified = false;
    if (manageBaseUrl && isNew) {
      const manageUrl = `${manageBaseUrl.replace(/\/+$/, '')}/book/manage/${organizationId}/${branchId}/${appointment.id}?token=${appointment.cancelToken}`;
      await this.notificationsQueue.enqueueSms({
        organizationId,
        to: dto.customerPhone,
        message: `Your ${appointment.serviceName} booking at ${appointment.resource.name} is confirmed for ${appointment.startTime.toLocaleString()}. Manage it: ${manageUrl}`,
      });
      notified = true;
    }

    return { ...appointment, notified };
  }

  /**
   * Both getBooking and cancelBooking below take the token as proof of
   * ownership, not the appointment id alone - ids are sequential-ish
   * UUIDs handed back in a URL, not secret; the token is the actual
   * capability. A wrong or missing token is treated identically to "not
   * found," the same "don't distinguish why" principle already applied
   * to auth (a deactivated OrgUser fails login the same generic way a
   * wrong password does) - this doesn't confirm whether the appointment
   * id exists at all to a caller who doesn't already hold its token.
   */
  async getBooking(
    organizationId: string,
    branchId: string,
    appointmentId: string,
    token: string,
  ) {
    return this.runForBranch(organizationId, branchId, async (tx) => {
      const appointment = await tx.salonAppointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          branchId: true,
          cancelToken: true,
          serviceName: true,
          startTime: true,
          endTime: true,
          status: true,
          resource: { select: { name: true } },
        },
      });
      if (
        !appointment ||
        appointment.branchId !== branchId ||
        appointment.cancelToken !== token
      ) {
        throw new NotFoundException('Booking not found');
      }
      return {
        id: appointment.id,
        serviceName: appointment.serviceName,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: appointment.status,
        resource: appointment.resource,
      };
    });
  }

  async cancelBooking(
    organizationId: string,
    branchId: string,
    appointmentId: string,
    token: string,
  ) {
    return this.runForBranch(organizationId, branchId, async (tx) => {
      const appointment = await tx.salonAppointment.findUnique({
        where: { id: appointmentId },
      });
      if (
        !appointment ||
        appointment.branchId !== branchId ||
        appointment.cancelToken !== token
      ) {
        throw new NotFoundException('Booking not found');
      }
      if (
        appointment.status !== 'SCHEDULED' &&
        appointment.status !== 'CONFIRMED'
      ) {
        throw new BadRequestException(
          `This booking is ${appointment.status.toLowerCase()} and can no longer be cancelled online - contact the business directly`,
        );
      }

      const updated = await tx.salonAppointment.update({
        where: { id: appointmentId },
        data: { status: 'CANCELLED' },
        select: {
          id: true,
          serviceName: true,
          startTime: true,
          endTime: true,
          status: true,
          resource: { select: { name: true } },
        },
      });
      return updated;
    });
  }
}
