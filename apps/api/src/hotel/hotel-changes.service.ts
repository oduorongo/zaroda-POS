import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoomBooking, RoomBookingStatus } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { cancellationOutcome } from './cancellation.util';
import {
  AmendBookingDto,
  CancellationRefundDto,
  CancelWithPolicyDto,
} from './dto/hotel-ops.dto';
import { isManagerOrAbove } from './folio.util';
import { FrontDeskService } from './front-desk.service';
import { HotelFolioService } from './hotel-folio.service';
import { HotelNotifierService } from './hotel-notifier.service';
import { loadRules } from './hotel-settings.service';
import { occupancyProblem, nightDates } from './pricing.util';
import {
  MAX_NIGHTS,
  nightsBetween,
  parseDay,
  todayInKenya,
} from './room-availability.util';
import { roomsLeft } from './room-stock';
import {
  breakdownOf,
  legacyNights,
  loadPricing,
  priceWith,
  readBreakdown,
  restitch,
} from './stay-pricing';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => Math.round(n * 100) / 100;
const OPEN: RoomBookingStatus[] = [
  RoomBookingStatus.CONFIRMED,
  RoomBookingStatus.CHECKED_IN,
];

/** What a guest has paid and not had back, from the folio (a marketplace deposit is posted onto it first). */
async function netPaid(
  folios: HotelFolioService,
  tx: TenantTx,
  booking: RoomBooking,
): Promise<number> {
  const folio = await folios.ensureFolio(tx, booking);
  const t = folios.summary(folio.entries);
  return money(t.payments - t.refunds);
}

/**
 * Changes to a booking after it was made: extending, shortening (early check-out), new dates, more or fewer rooms, another room
 * type, other guests or meal plan; and cancelling under the hotel's policy. Every change re-checks the rooms under the SAME
 * per-room-type lock bookings use, prices the stay again with the same function, puts the difference on the folio as new entries,
 * and is audit-logged with the reason.
 */
@Injectable()
export class HotelChangesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
    private readonly folios: HotelFolioService,
    private readonly desk: FrontDeskService,
    private readonly notifier: HotelNotifierService,
  ) {}

  // ── Changing a stay ────────────────────────────────────────────────────

  async amend(bookingId: string, dto: AmendBookingDto) {
    const { orgUserId, role } = getTenantStore();
    if (dto.rate !== undefined && !isManagerOrAbove(role))
      throw new ForbiddenException(
        'Only a manager or owner can change the room rate',
      );

    const outcome = await this.tenantPrisma.run(async (tx) => {
      const booking = await this.folios.loadBooking(tx, bookingId);
      if (!OPEN.includes(booking.status))
        throw new ConflictException(
          `This booking is ${booking.status.toLowerCase().replace('_', ' ')}, so it cannot be changed`,
        );
      const inHouse = booking.status === RoomBookingStatus.CHECKED_IN;
      const today = todayInKenya();

      const checkIn = dto.checkIn ? parseDay(dto.checkIn) : booking.checkIn;
      const checkOut = dto.checkOut ? parseDay(dto.checkOut) : booking.checkOut;
      if (!checkIn || !checkOut)
        throw new BadRequestException('Choose real dates');
      if (inHouse && checkIn.getTime() !== booking.checkIn.getTime())
        throw new BadRequestException(
          'The arrival date of a guest who is already in cannot be changed',
        );
      if (!inHouse && checkIn.getTime() < today.getTime())
        throw new BadRequestException('The check-in date has already passed');
      if (inHouse && checkOut.getTime() < today.getTime())
        throw new BadRequestException(
          'A guest in the house cannot be given a check-out date that has already passed',
        );
      const nights = nightsBetween(checkIn, checkOut);
      if (nights < 1)
        throw new BadRequestException('Check-out must be after check-in');
      if (nights > MAX_NIGHTS)
        throw new BadRequestException(
          `A stay can be up to ${MAX_NIGHTS} nights`,
        );

      const rooms = dto.rooms ?? booking.rooms;
      const children = dto.children ?? booking.children;
      const adults =
        dto.adults ?? booking.adults ?? booking.guests - booking.children;
      const mealPlan = dto.mealPlan ?? booking.mealPlan;
      const typeChanged =
        dto.roomTypeId !== undefined && dto.roomTypeId !== booking.roomTypeId;
      const newType = await tx.hotelRoomType.findFirst({
        where: {
          id: dto.roomTypeId ?? booking.roomTypeId,
          ...(typeChanged ? { isActive: true } : {}),
        },
      });
      if (!newType)
        throw new NotFoundException('That room type is not available');
      if (rooms > newType.quantity)
        throw new BadRequestException(
          `The hotel has ${newType.quantity} ${newType.name} room${newType.quantity === 1 ? '' : 's'}`,
        );
      const tooMany = occupancyProblem(
        { rooms, adults, children },
        newType.maxGuests,
      );
      if (tooMany) throw new BadRequestException(tooMany);

      // The same per-room-type lock a new booking takes (both types, in a fixed order, so two changes cannot deadlock).
      for (const id of [...new Set([booking.roomTypeId, newType.id])].sort())
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'room-type:' + id}))`;
      const left = await roomsLeft(
        tx,
        newType,
        checkIn,
        checkOut,
        new Date(),
        booking.id,
      );
      if (left < rooms)
        throw new ConflictException(
          left > 0
            ? `Only ${left} ${newType.name} room${left === 1 ? '' : 's'} free for the new dates`
            : `No ${newType.name} rooms are free for the new dates`,
        );

      // Price: nights already agreed keep their price when only the dates change; anything about the room, guests, meals or rate
      // being changed prices the whole stay again from today's price list.
      const stored = readBreakdown(booking.priceBreakdown);
      const oldNights =
        stored?.nights ??
        legacyNights(
          booking,
          nightDates(iso(booking.checkIn), iso(booking.checkOut)),
        );
      const pricing = await loadPricing(tx, newType);
      const flatRate =
        dto.rate !== undefined
          ? dto.rate
          : typeChanged
            ? undefined
            : (stored?.flatRate ?? undefined);
      const fresh = priceWith(pricing, {
        checkIn: iso(checkIn),
        checkOut: iso(checkOut),
        rooms,
        adults,
        children,
        mealPlan,
        rate: flatRate,
      });
      const repriceAll =
        typeChanged ||
        dto.rate !== undefined ||
        rooms !== booking.rooms ||
        adults !== (booking.adults ?? booking.guests - booking.children) ||
        children !== booking.children ||
        mealPlan !== booking.mealPlan;
      const price = repriceAll
        ? fresh
        : restitch(
            fresh.nights.map(
              (n) => oldNights.find((o) => o.date === n.date) ?? n,
            ),
            rooms,
          );

      const oldTotal = Number(booking.total);
      const preview = {
        before: {
          checkIn: iso(booking.checkIn),
          checkOut: iso(booking.checkOut),
          nights: booking.nights,
          rooms: booking.rooms,
          roomTypeName: booking.roomTypeName,
          total: oldTotal,
        },
        after: {
          checkIn: iso(checkIn),
          checkOut: iso(checkOut),
          nights,
          rooms,
          roomTypeName: newType.name,
          total: price.total,
        },
        difference: money(price.total - oldTotal),
        repricedWholeStay: repriceAll,
        flatRateDropped:
          typeChanged && stored?.flatRate != null && dto.rate === undefined,
      };
      if (dto.dryRun) return { preview, applied: false as const };

      // Rooms the guest is in (or has been promised) when the number of rooms or their type changes.
      const roomsChange = rooms !== booking.rooms || typeChanged;
      if (dto.roomIds && !(inHouse && roomsChange))
        throw new BadRequestException(
          inHouse
            ? 'Rooms are only chosen when the rooms or room type change'
            : 'Rooms are chosen at check-in',
        );
      if (inHouse && roomsChange)
        await this.moveInHouseRooms(
          tx,
          booking,
          newType.id,
          rooms,
          dto.roomIds,
          dto.reason,
          orgUserId,
        );
      else if (!inHouse && roomsChange)
        await tx.hotelRoomAssignment.deleteMany({
          where: { bookingId, toAt: null },
        });
      else if (
        !inHouse &&
        (checkIn.getTime() !== booking.checkIn.getTime() ||
          checkOut.getTime() !== booking.checkOut.getTime())
      ) {
        // a room asked for at booking time must still be free on the new dates
        for (const a of await tx.hotelRoomAssignment.findMany({
          where: { bookingId, toAt: null },
        })) {
          const clash = await tx.hotelRoomAssignment.findFirst({
            where: {
              roomId: a.roomId,
              toAt: null,
              booking: {
                id: { not: bookingId },
                status: { in: OPEN },
                checkIn: { lt: checkOut },
                checkOut: { gt: checkIn },
              },
            },
          });
          if (clash)
            await tx.hotelRoomAssignment.delete({ where: { id: a.id } });
        }
      }

      const updated = await tx.roomBooking.updateMany({
        where: { id: bookingId, status: booking.status },
        data: {
          checkIn,
          checkOut,
          nights,
          rooms,
          guests: adults + children,
          adults,
          children,
          mealPlan,
          roomTypeId: newType.id,
          roomTypeName: newType.name,
          pricePerNight: price.averageRate,
          total: price.total,
          priceBreakdown: breakdownOf(
            price,
            flatRate ?? null,
          ) as unknown as Prisma.InputJsonValue,
          ...(dto.rate !== undefined ? { rateOverriddenBy: orgUserId } : {}),
        },
      });
      if (updated.count === 0)
        throw new ConflictException(
          'This booking was just changed by someone else - refresh',
        );

      const fresh2 = await this.folios.loadBooking(tx, bookingId);
      let folioEntries = 0;
      const folio = await tx.hotelFolio.findUnique({
        where: { bookingId },
        include: { entries: true },
      });
      if (folio)
        folioEntries = await this.folios.syncRoomNights(
          tx,
          fresh2,
          folio,
          orgUserId,
          dto.reason,
        );
      await this.auditLog.logInTx(tx, {
        action: 'hotel.booking_amended',
        entityType: 'RoomBooking',
        entityId: bookingId,
        before: preview.before,
        after: {
          ...preview.after,
          difference: preview.difference,
          reason: dto.reason,
          folioEntries,
        },
      });
      if (dto.rate !== undefined)
        await this.auditLog.logInTx(tx, {
          action: 'hotel.rate_overridden',
          entityType: 'RoomBooking',
          entityId: bookingId,
          before: { rate: Number(booking.pricePerNight) },
          after: { rate: dto.rate },
        });
      return { preview, applied: true as const };
    });

    return { ...outcome, booking: await this.desk.detail(bookingId) };
  }

  /** In-house guests: who stays in which rooms after the number of rooms or the room type changed. */
  private async moveInHouseRooms(
    tx: TenantTx,
    booking: RoomBooking,
    roomTypeId: string,
    rooms: number,
    roomIds: string[] | undefined,
    reason: string,
    orgUserId: string,
  ) {
    if (
      !roomIds ||
      roomIds.length !== rooms ||
      new Set(roomIds).size !== roomIds.length
    )
      throw new BadRequestException(
        `Choose the ${rooms} room${rooms === 1 ? '' : 's'} the guest will be in`,
      );
    const current = await tx.hotelRoomAssignment.findMany({
      where: { bookingId: booking.id, toAt: null },
    });
    const typeChanged = roomTypeId !== booking.roomTypeId;
    const stays = new Set(
      typeChanged
        ? []
        : current
            .filter((a) => roomIds.includes(a.roomId))
            .map((a) => a.roomId),
    );
    for (const id of roomIds.filter((r) => !stays.has(r))) {
      const room = await tx.hotelRoom.findUnique({ where: { id } });
      if (!room || !room.isActive || room.roomTypeId !== roomTypeId)
        throw new BadRequestException(
          'One of those rooms is not a room of the booked type',
        );
      const claimed = await tx.hotelRoom.updateMany({
        where: { id, status: 'VACANT_CLEAN', isActive: true },
        data: { status: 'OCCUPIED' },
      });
      if (claimed.count === 0)
        throw new ConflictException(
          `Room ${room.number} is not vacant and clean`,
        );
      await tx.hotelRoomAssignment.create({
        data: {
          bookingId: booking.id,
          roomId: id,
          movedBy: orgUserId,
          reason: `Stay changed: ${reason}`,
        },
      });
    }
    for (const a of current.filter((c) => !stays.has(c.roomId))) {
      await tx.hotelRoomAssignment.update({
        where: { id: a.id },
        data: { toAt: new Date() },
      });
      await tx.hotelRoom.updateMany({
        where: { id: a.roomId, status: 'OCCUPIED' },
        data: { status: 'VACANT_DIRTY' },
      });
    }
  }

  // ── Cancelling ─────────────────────────────────────────────────────────

  /** What cancelling now would cost the guest, without doing it. */
  async cancelPreview(bookingId: string, waive = false) {
    return this.tenantPrisma.run(async (tx) => {
      const booking = await this.folios.loadBooking(tx, bookingId);
      return this.previewIn(tx, booking, waive);
    });
  }

  private async previewIn(tx: TenantTx, booking: RoomBooking, waive: boolean) {
    const rules = await loadRules(tx);
    const unpaidOnline = booking.status === RoomBookingStatus.PENDING_PAYMENT;
    const paid = unpaidOnline ? 0 : await netPaid(this.folios, tx, booking);
    return {
      status: booking.status,
      policy: {
        freeDays: rules.cancelFreeDays,
        keepPercent: rules.cancelKeepPercent,
      },
      arrival: iso(booking.checkIn),
      ...cancellationOutcome({
        paid,
        arrival: booking.checkIn,
        today: todayInKenya(),
        policy: {
          freeDays: rules.cancelFreeDays,
          keepPercent: rules.cancelKeepPercent,
        },
        waive,
      }),
    };
  }

  /** Cancels (or marks a no-show): applies the policy, keeps the fee, works out the refund the hotel owes, texts the guest. */
  async cancel(bookingId: string, dto: CancelWithPolicyDto, noShow = false) {
    const { organizationId, role } = getTenantStore();
    if (dto.waiveFee && !isManagerOrAbove(role))
      throw new ForbiddenException(
        'Only a manager or owner can waive the cancellation fee',
      );
    const result = await this.tenantPrisma.run(async (tx) => {
      const booking = await this.folios.loadBooking(tx, bookingId);
      const allowed: RoomBookingStatus[] = noShow
        ? [RoomBookingStatus.CONFIRMED]
        : [RoomBookingStatus.PENDING_PAYMENT, RoomBookingStatus.CONFIRMED];
      if (!allowed.includes(booking.status))
        throw new BadRequestException(
          `This booking is ${booking.status.toLowerCase().replace('_', ' ')} - that action is not available`,
        );
      const preview = await this.previewIn(tx, booking, dto.waiveFee === true);
      const moved = await tx.roomBooking.updateMany({
        where: { id: bookingId, status: booking.status },
        data: {
          status: noShow
            ? RoomBookingStatus.NO_SHOW
            : RoomBookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: dto.reason.trim(),
          cancelFeeKept: preview.feeKept,
          commissionAmount: 0,
        },
      });
      if (moved.count === 0)
        throw new ConflictException(
          'This booking was just updated by someone else - refresh',
        );
      await tx.hotelRoomAssignment.deleteMany({
        where: { bookingId, toAt: null },
      });
      await this.auditLog.logInTx(tx, {
        action: noShow ? 'hotel.booking_no_show' : 'hotel.booking_cancelled',
        entityType: 'RoomBooking',
        entityId: bookingId,
        after: {
          reason: dto.reason,
          paid: preview.paid,
          feeKept: preview.feeKept,
          refundDue: preview.refundDue,
          daysBefore: preview.daysBefore,
          waived: preview.waived,
        },
      });
      return preview;
    });
    if (result.paid > 0 || !noShow)
      void this.notifier.send(organizationId, bookingId, 'CANCELLATION', {
        refundDue: result.refundDue,
        feeKept: result.feeKept,
      });
    return {
      ...(await this.desk.detail(bookingId)),
      cancellation: result,
      refundDue: result.refundDue,
      feeKept: result.feeKept,
    };
  }

  /** The hotel hands back what the policy says it owes: recorded as a REFUND on the folio (once). */
  async recordRefund(bookingId: string, dto: CancellationRefundDto) {
    const { orgUserId } = getTenantStore();
    if (dto.method === 'MPESA_RECEIPT' && !dto.reference)
      throw new BadRequestException('Enter the M-Pesa reference of the refund');
    return this.tenantPrisma.run(async (tx) => {
      const booking = await this.folios.loadBooking(tx, bookingId);
      if (
        booking.status !== RoomBookingStatus.CANCELLED &&
        booking.status !== RoomBookingStatus.NO_SHOW
      )
        throw new ConflictException(
          'Only a cancelled booking has a cancellation refund',
        );
      const folio = await this.folios.ensureFolio(tx, booking);
      const totals = this.folios.summary(folio.entries);
      const owed = money(
        totals.payments - totals.refunds - Number(booking.cancelFeeKept ?? 0),
      );
      if (owed <= 0.001)
        throw new ConflictException(
          'There is nothing left to refund on this booking',
        );
      const entry = await tx.hotelFolioEntry.create({
        data: {
          folioId: folio.id,
          type: 'REFUND',
          amount: owed,
          description: `Refund: cancellation (${booking.bookingNumber})`,
          method: dto.method,
          reference: dto.reference || null,
          createdById: orgUserId,
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.cancellation_refund',
        entityType: 'RoomBooking',
        entityId: bookingId,
        after: {
          amount: owed,
          method: dto.method,
          reference: dto.reference ?? null,
        },
      });
      return {
        refunded: owed,
        entryId: entry.id,
        feeKept: Number(booking.cancelFeeKept ?? 0),
      };
    });
  }
}
