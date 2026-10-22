import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RoomBookingStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { parseRoomChargeReference } from './folio.util';
import { HotelFolioService } from './hotel-folio.service';

/**
 * Charging a sale to a hotel guest's room. The sale code knows nothing about hotels: it asks (an event) whether a room account
 * accepts the charge, and this answers - yes only for a guest who is checked in. After the sale is saved, the amount is added to
 * the guest's folio as a CHARGE. (If that second step were ever lost, check-out finds the sale and adds it then.)
 */
@Injectable()
export class RoomChargeService {
  private readonly logger = new Logger(RoomChargeService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly folios: HotelFolioService,
  ) {}

  @OnEvent('sale.roomCharge.verify')
  async verify(payload: {
    providerReference: string;
    amount: number;
  }): Promise<boolean> {
    const ref = parseRoomChargeReference(payload.providerReference);
    if (!ref) return false;
    const booking = await this.tenantPrisma.run((tx) =>
      tx.roomBooking.findUnique({ where: { id: ref.bookingId } }),
    );
    if (!booking)
      throw new BadRequestException('That room booking was not found');
    if (booking.status !== RoomBookingStatus.CHECKED_IN)
      throw new BadRequestException(
        `${booking.guestName} is not checked in, so nothing can be charged to their room`,
      );
    return true;
  }

  @OnEvent('sale.afterComplete')
  async post(sale: {
    id: string;
    cashierOrgUserId: string | null;
    payments: {
      method: string;
      amount: unknown;
      providerReference: string | null;
    }[];
  }): Promise<void> {
    for (const payment of sale.payments) {
      if (payment.method !== 'ROOM_CHARGE') continue;
      const ref = parseRoomChargeReference(payment.providerReference);
      if (!ref) continue;
      try {
        await this.tenantPrisma.run(async (tx) => {
          const booking = await this.folios.loadBooking(tx, ref.bookingId);
          const folio = await this.folios.ensureFolio(tx, booking);
          if (folio.entries.some((e) => e.saleId === sale.id)) return;
          await tx.hotelFolioEntry.create({
            data: {
              folioId: folio.id,
              type: 'CHARGE',
              amount: Number(payment.amount),
              description: 'Charged to room',
              saleId: sale.id,
              createdById: sale.cashierOrgUserId ?? 'till',
            },
          });
        });
      } catch (e) {
        // never fails the sale; check-out adds anything missed
        this.logger.error(
          { err: e },
          `Could not add sale ${sale.id} to the room folio`,
        );
      }
    }
  }
}
