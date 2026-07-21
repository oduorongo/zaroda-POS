import { BadRequestException } from '@nestjs/common';
import { SalonAppointmentStatus } from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';

/**
 * The actual "resource scheduling" value the salon module exists for:
 * two appointments for the same resource with overlapping time ranges
 * is rejected outright, not left for a human to notice later. A
 * cancelled/no-show appointment doesn't block the slot it was going to
 * occupy - the resource is genuinely free again once an appointment is
 * no longer actually happening.
 *
 * Extracted out of SalonAppointmentsService.create() so the public,
 * unauthenticated booking flow (public-booking/) can share the exact
 * same double-booking prevention rather than a second copy that could
 * drift - this is business-critical enough (an actual double-booked
 * chair) that having it in two places would be a real risk, not just
 * duplication for its own sake.
 */
export async function assertNoOverlap(
  tx: TenantTx,
  resourceId: string,
  resourceName: string,
  startTime: Date,
  endTime: Date,
) {
  const overlapping = await tx.salonAppointment.findFirst({
    where: {
      resourceId,
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
      `${resourceName} is already booked from ${overlapping.startTime.toISOString()} to ${overlapping.endTime.toISOString()}`,
    );
  }
}
