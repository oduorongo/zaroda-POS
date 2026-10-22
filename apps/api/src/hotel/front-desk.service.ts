import { randomInt } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HotelFolioEntry,
  Prisma,
  PaymentMethod,
  RoomBooking,
  RoomBookingStatus,
} from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { CreateFrontDeskBookingDto } from './dto/front-desk.dto';
import {
  folioTotals,
  isManagerOrAbove,
  isSupervisorOrAbove,
} from './folio.util';
import { HotelFolioService } from './hotel-folio.service';
import { PhysicalRoomsService } from './physical-rooms.service';
import {
  nightsBetween,
  parseDay,
  stayProblem,
  stayTotal,
  todayInKenya,
} from './room-availability.util';
import { roomsLeft } from './room-stock';

const NUMBER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const generateBookingNumber = () =>
  `ZB-${Array.from({ length: 6 }, () => NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)]).join('')}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** "A1234567" -> "****4567": lists never show a whole ID or passport number. */
export function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.length <= 4
    ? '****'
    : `${'*'.repeat(Math.min(v.length - 4, 8))}${v.slice(-4)}`;
}

/** A guest's phone as typed: a Kenyan mobile is normalised to 2547..., anything else (a visitor's number) is kept as digits with a plus. */
export function guestPhone(input: string): string | null {
  const kenyan = normalizeKenyanPhone(input);
  if (kenyan) return kenyan;
  const cleaned = input.replace(/[^\d+]/g, '');
  return /^\+?\d{6,18}$/.test(cleaned) ? cleaned : null;
}

type BookingWithRooms = RoomBooking & {
  assignments: { room: { number: string }; toAt: Date | null }[];
  folio: { entries: HotelFolioEntry[] } | null;
};

/** Front-desk bookings (walk-in or phone, no marketplace or payment gateway needed) and the day's board. */
@Injectable()
export class FrontDeskService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
    private readonly folios: HotelFolioService,
    private readonly rooms: PhysicalRoomsService,
  ) {}

  /** One booking as the desk lists show it (the ID number masked to its last four digits). */
  private deskView(b: BookingWithRooms) {
    const totals = b.folio
      ? folioTotals(
          b.folio.entries.map((e) => ({
            type: e.type,
            amount: Number(e.amount),
            taxAmount: Number(e.taxAmount),
          })),
        )
      : null;
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: b.status,
      source: b.source,
      guestName: b.guestName,
      guestPhone: b.guestPhone,
      idNumber: maskId(b.idNumber),
      nationality: b.nationality,
      guests: b.guests,
      rooms: b.rooms,
      roomTypeId: b.roomTypeId,
      roomTypeName: b.roomTypeName,
      roomNumbers: b.assignments
        .filter((a) => !a.toAt)
        .map((a) => a.room.number),
      checkIn: iso(b.checkIn),
      checkOut: iso(b.checkOut),
      nights: b.nights,
      pricePerNight: Number(b.pricePerNight),
      total: Number(b.total),
      notes: b.notes,
      // balance is only known once the folio exists (a deposit paid, or the stay started)
      balance: totals ? totals.balance : null,
      paid: totals
        ? totals.payments - totals.refunds
        : b.paidAt
          ? b.depositAmount
          : 0,
      checkedInAt: b.checkedInAt,
      checkedOutAt: b.checkedOutAt,
    };
  }

  private static include = {
    assignments: { select: { room: { select: { number: true } }, toAt: true } },
    folio: { select: { entries: true } },
  } as const;

  /** Today at the front desk: who arrives, who is in, who leaves, and the room grid. */
  async board(dateInput?: string) {
    const date = (dateInput && parseDay(dateInput)) || todayInKenya();
    const [expected, inside, rooms] = await Promise.all([
      // guests due to arrive today, or who were due earlier and have not turned up yet
      this.tenantPrisma.run((tx) =>
        tx.roomBooking.findMany({
          where: {
            status: RoomBookingStatus.CONFIRMED,
            checkIn: { lte: date },
            checkOut: { gt: date },
          },
          include: FrontDeskService.include,
          orderBy: [{ checkIn: 'asc' }, { createdAt: 'asc' }],
          take: 500,
        }),
      ),
      // everyone checked in, whatever their dates (an early check-in, or a stay left open past its check-out date)
      this.tenantPrisma.run((tx) =>
        tx.roomBooking.findMany({
          where: { status: RoomBookingStatus.CHECKED_IN },
          include: FrontDeskService.include,
          orderBy: [{ checkOut: 'asc' }, { createdAt: 'asc' }],
          take: 1000,
        }),
      ),
      this.rooms.list(),
    ]);
    const views = [...expected, ...inside].map((b) =>
      this.deskView(b as BookingWithRooms),
    );
    const counts = {
      VACANT_CLEAN: 0,
      VACANT_DIRTY: 0,
      OCCUPIED: 0,
      OUT_OF_ORDER: 0,
    };
    for (const r of rooms) counts[r.status] += 1;
    return {
      date: iso(date),
      arrivals: views.filter(
        (v) =>
          v.status === 'CONFIRMED' &&
          v.checkIn <= iso(date) &&
          v.checkOut > iso(date),
      ),
      inHouse: views.filter(
        (v) => v.status === 'CHECKED_IN' && v.checkOut > iso(date),
      ),
      departures: views.filter(
        (v) => v.status === 'CHECKED_IN' && v.checkOut <= iso(date),
      ),
      rooms,
      roomCounts: counts,
    };
  }

  /** Checked-in guests with their rooms and what they owe, for the till's "charge to room" list. */
  async inHouse() {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.roomBooking.findMany({
        where: { status: RoomBookingStatus.CHECKED_IN },
        include: FrontDeskService.include,
        orderBy: { checkIn: 'asc' },
        take: 500,
      }),
    );
    return rows.map((b) => {
      const v = this.deskView(b as BookingWithRooms);
      return {
        bookingId: v.id,
        guestName: v.guestName,
        roomNumbers: v.roomNumbers,
        checkOut: v.checkOut,
        balance: v.balance,
      };
    });
  }

  /** One booking with its folio, who is in which room, and (for a supervisor or above) the full ID number. */
  async detail(id: string) {
    const { role } = getTenantStore();
    const booking = await this.tenantPrisma.run((tx) =>
      tx.roomBooking.findUnique({
        where: { id },
        include: FrontDeskService.include,
      }),
    );
    if (!booking) throw new NotFoundException('Booking not found');
    const view = this.deskView(booking as BookingWithRooms);
    return {
      ...view,
      idNumber: isSupervisorOrAbove(role) ? booking.idNumber : view.idNumber,
      guestEmail: booking.guestEmail,
      commissionRate: Number(booking.commissionRate),
    };
  }

  /**
   * Books a room for a walk-in or phone guest. Availability uses the SAME count and the SAME per-room-type lock as a marketplace
   * booking, so the two can never sell the last room twice. No commission applies (that is for marketplace bookings only).
   */
  async create(dto: CreateFrontDeskBookingDto) {
    const { organizationId, orgUserId, role } = getTenantStore();
    const phone = guestPhone(dto.phone);
    if (!phone) throw new BadRequestException('Enter a valid phone number');
    const checkIn = parseDay(dto.checkIn);
    const checkOut = parseDay(dto.checkOut);
    const problem = stayProblem(checkIn, checkOut, todayInKenya());
    if (problem || !checkIn || !checkOut)
      throw new BadRequestException(problem ?? 'Choose the dates');
    if (dto.rate !== undefined && !isManagerOrAbove(role))
      throw new ForbiddenException(
        'Only a manager or owner can change the room rate',
      );
    if (dto.deposit?.method === 'MPESA_RECEIPT' && !dto.deposit.reference)
      throw new BadRequestException(
        'Enter the M-Pesa receipt code for the deposit',
      );
    const rooms = dto.rooms ?? 1;
    if (dto.roomId && rooms !== 1)
      throw new BadRequestException(
        'A particular room can only be asked for on a one-room booking',
      );
    const nights = nightsBetween(checkIn, checkOut);

    let created: BookingWithRooms | undefined;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await this.tenantPrisma.run(async (tx) => {
          const roomType = await tx.hotelRoomType.findFirst({
            where: { id: dto.roomTypeId, isActive: true },
          });
          if (!roomType)
            throw new NotFoundException('That room type is not available');
          if (rooms > roomType.quantity)
            throw new BadRequestException(
              `The hotel has ${roomType.quantity} ${roomType.name} room${roomType.quantity === 1 ? '' : 's'}`,
            );
          if (dto.guests > roomType.maxGuests * rooms)
            throw new BadRequestException(
              `A ${roomType.name} sleeps up to ${roomType.maxGuests}. Use more rooms or fewer guests.`,
            );

          // Two bookings (a guest online and the desk) must not take the last room between the check and the insert.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'room-type:' + roomType.id}))`;
          const left = await roomsLeft(tx, roomType, checkIn, checkOut);
          if (left < rooms)
            throw new ConflictException(
              left > 0
                ? `Only ${left} ${roomType.name} room${left === 1 ? '' : 's'} left for those dates`
                : `No ${roomType.name} rooms are free for those dates`,
            );

          const org = await tx.organization.findUniqueOrThrow({
            where: { id: organizationId },
            select: { name: true },
          });
          const listed = Number(roomType.pricePerNight);
          const rate = dto.rate ?? listed;
          const booking = await tx.roomBooking.create({
            data: {
              organizationId,
              roomTypeId: roomType.id,
              bookingNumber: generateBookingNumber(),
              status: RoomBookingStatus.CONFIRMED,
              source: dto.source ?? 'FRONT_DESK',
              guestName: dto.guestName,
              guestPhone: phone,
              guestEmail: dto.email || null,
              idNumber: dto.idNumber || null,
              nationality: dto.nationality || null,
              guests: dto.guests,
              rooms,
              checkIn,
              checkOut,
              nights,
              notes: dto.notes || null,
              hotelName: org.name,
              roomTypeName: roomType.name,
              pricePerNight: rate,
              total: stayTotal(rate, nights, rooms),
              depositAmount: 0,
              commissionRate: 0,
              createdById: orgUserId,
              rateOverriddenBy: rate !== listed ? orgUserId : null,
            },
          });

          if (dto.roomId) {
            const room = await tx.hotelRoom.findUnique({
              where: { id: dto.roomId },
            });
            if (!room || !room.isActive || room.roomTypeId !== roomType.id)
              throw new BadRequestException(
                'That room is not a room of this type',
              );
            if (room.status === 'OUT_OF_ORDER')
              throw new ConflictException(
                `Room ${room.number} is out of order`,
              );
            const clash = await tx.hotelRoomAssignment.findFirst({
              where: {
                roomId: room.id,
                toAt: null,
                booking: {
                  id: { not: booking.id },
                  status: {
                    in: [
                      RoomBookingStatus.CONFIRMED,
                      RoomBookingStatus.CHECKED_IN,
                    ],
                  },
                  checkIn: { lt: checkOut },
                  checkOut: { gt: checkIn },
                },
              },
            });
            if (clash)
              throw new ConflictException(
                `Room ${room.number} is already promised to another guest for those dates`,
              );
            await tx.hotelRoomAssignment.create({
              data: {
                bookingId: booking.id,
                roomId: room.id,
                movedBy: orgUserId,
                reason: 'Asked for at booking',
              },
            });
          }

          if (dto.deposit) {
            const folio = await this.folios.ensureFolio(tx, booking);
            await tx.hotelFolioEntry.create({
              data: {
                folioId: folio.id,
                type: 'PAYMENT',
                amount: dto.deposit.amount,
                description: 'Deposit',
                method: dto.deposit.method as PaymentMethod,
                reference: dto.deposit.reference || null,
                createdById: orgUserId,
              },
            });
          }

          await this.auditLog.logInTx(tx, {
            action: 'hotel.booking_created',
            entityType: 'RoomBooking',
            entityId: booking.id,
            after: {
              source: booking.source,
              roomTypeId: roomType.id,
              checkIn: iso(checkIn),
              checkOut: iso(checkOut),
              rooms,
              rate,
              deposit: dto.deposit?.amount ?? 0,
            },
          });
          if (rate !== listed) {
            await this.auditLog.logInTx(tx, {
              action: 'hotel.rate_overridden',
              entityType: 'RoomBooking',
              entityId: booking.id,
              before: { rate: listed },
              after: { rate },
            });
          }
          return tx.roomBooking.findUniqueOrThrow({
            where: { id: booking.id },
            include: FrontDeskService.include,
          }) as Promise<BookingWithRooms>;
        });
      } catch (e) {
        const collided =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          JSON.stringify(e.meta?.target ?? '').includes('bookingNumber');
        if (!collided) throw e;
      }
    }
    if (!created)
      throw new ConflictException('Could not create the booking - try again');
    return this.deskView(created);
  }
}
