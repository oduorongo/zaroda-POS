import { RoomBookingStatus } from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { bookingHoldsRooms, roomsTaken } from './room-availability.util';

/** How many rooms of a type are still free for every night of a stay: the type's rooms minus the busiest night. */
export async function roomsLeft(tx: TenantTx, roomType: { id: string; quantity: number }, checkIn: Date, checkOut: Date, now: Date = new Date(), excludeBookingId?: string): Promise<number> {
  const bookings = await tx.roomBooking.findMany({
    where: {
      roomTypeId: roomType.id,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
      status: { in: [RoomBookingStatus.CONFIRMED, RoomBookingStatus.CHECKED_IN, RoomBookingStatus.PENDING_PAYMENT] },
    },
    select: { checkIn: true, checkOut: true, rooms: true, status: true, paymentDeadline: true },
  });
  const held = bookings.filter((b) => bookingHoldsRooms(b, now));
  return Math.max(0, roomType.quantity - roomsTaken(held, checkIn, checkOut));
}
