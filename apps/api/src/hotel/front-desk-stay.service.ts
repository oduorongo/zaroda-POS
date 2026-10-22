import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, RoomBookingStatus } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { roundMoney } from '../online-orders/online-orders.util';
import { SalesService } from '../sales/sales.service';
import { CheckInDto, CheckOutDto, MoveRoomDto } from './dto/front-desk.dto';
import {
  allocateToSettlement,
  checkInProblem,
  checkOutProblem,
  isManagerOrAbove,
  netPayments,
  settlementClientId,
  settlementReference,
  settlementTotal,
} from './folio.util';
import { FrontDeskService } from './front-desk.service';
import { HotelFolioService, roomTaxRate } from './hotel-folio.service';
import { todayInKenya } from './room-availability.util';

/** The built-in "device" hotel sales are filed under, one per branch. It is not a real till (like the online shop's). */
export const FRONT_DESK_TERMINAL_LABEL = 'Front desk';

/**
 * A guest's stay: checking in (into a vacant, clean room of the booked type), moving rooms, and checking out - which settles
 * the folio. At check-out the room nights become ONE ordinary sale (SalesService.create), so room revenue is in Sales,
 * Reports, profit and tax. Charges that were already sold at the till (charged to the room) are not sold again.
 */
@Injectable()
export class FrontDeskStayService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
    private readonly folios: HotelFolioService,
    private readonly sales: SalesService,
    private readonly desk: FrontDeskService,
  ) {}

  // ── Check-in ──────────────────────────────────────────────────────────

  async checkIn(bookingId: string, dto: CheckInDto) {
    const { role, orgUserId } = getTenantStore();
    const wantsEarly = dto.overrideEarly === true;
    if (new Set(dto.roomIds).size !== dto.roomIds.length)
      throw new BadRequestException('A room is listed twice');

    await this.tenantPrisma.run(async (tx) => {
      const booking = await this.folios.loadBooking(tx, bookingId);
      if (booking.status !== RoomBookingStatus.CONFIRMED) {
        throw new ConflictException(
          `This booking is ${booking.status.toLowerCase().replace('_', ' ')}, so the guest cannot be checked in`,
        );
      }
      const today = todayInKenya();
      const early = today.getTime() < booking.checkIn.getTime();
      const problem = checkInProblem(
        today,
        booking.checkIn,
        booking.checkOut,
        role,
        wantsEarly,
      );
      if (problem)
        throw new (
          early && wantsEarly ? ForbiddenException : BadRequestException
        )(problem);
      if (dto.roomIds.length !== booking.rooms)
        throw new BadRequestException(
          `This booking is for ${booking.rooms} room${booking.rooms === 1 ? '' : 's'} - choose that many`,
        );

      const rooms = await tx.hotelRoom.findMany({
        where: { id: { in: dto.roomIds } },
      });
      if (rooms.length !== dto.roomIds.length)
        throw new NotFoundException('One of those rooms was not found');
      for (const room of rooms) {
        if (!room.isActive)
          throw new BadRequestException(`Room ${room.number} is not in use`);
        if (room.roomTypeId !== booking.roomTypeId)
          throw new BadRequestException(
            `Room ${room.number} is not a ${booking.roomTypeName} room`,
          );
        // The status flip is the claim: two receptionists cannot put two guests in one room.
        const claimed = await tx.hotelRoom.updateMany({
          where: { id: room.id, status: 'VACANT_CLEAN', isActive: true },
          data: { status: 'OCCUPIED' },
        });
        if (claimed.count === 0) {
          const now = await tx.hotelRoom.findUniqueOrThrow({
            where: { id: room.id },
          });
          throw new ConflictException(
            `Room ${room.number} is ${now.status === 'VACANT_DIRTY' ? 'not cleaned yet' : now.status === 'OCCUPIED' ? 'occupied' : 'out of order'}`,
          );
        }
      }

      // Rooms promised at booking time were only a wish; what is chosen now is what counts.
      await tx.hotelRoomAssignment.deleteMany({
        where: { bookingId, toAt: null },
      });
      for (const room of rooms)
        await tx.hotelRoomAssignment.create({
          data: { bookingId, roomId: room.id, movedBy: orgUserId },
        });

      const moved = await tx.roomBooking.updateMany({
        where: { id: bookingId, status: RoomBookingStatus.CONFIRMED },
        data: {
          status: RoomBookingStatus.CHECKED_IN,
          checkedInAt: new Date(),
          ...(early ? { earlyCheckInBy: orgUserId } : {}),
        },
      });
      if (moved.count === 0)
        throw new ConflictException(
          'This booking was just changed by someone else - refresh',
        );

      const fresh = await this.folios.loadBooking(tx, bookingId);
      const folio = await this.folios.ensureFolio(tx, fresh);
      await this.folios.postNights(tx, fresh, folio, orgUserId);
      await this.auditLog.logInTx(tx, {
        action: 'hotel.check_in',
        entityType: 'RoomBooking',
        entityId: bookingId,
        after: { rooms: rooms.map((r) => r.number) },
      });
      if (early)
        await this.auditLog.logInTx(tx, {
          action: 'hotel.early_check_in',
          entityType: 'RoomBooking',
          entityId: bookingId,
          after: { arrival: booking.checkIn.toISOString().slice(0, 10) },
        });
    });
    return this.desk.detail(bookingId);
  }

  // ── Room move ─────────────────────────────────────────────────────────

  async moveRoom(bookingId: string, dto: MoveRoomDto) {
    const { orgUserId } = getTenantStore();
    if (dto.fromRoomId === dto.toRoomId)
      throw new BadRequestException('That is the room the guest is already in');
    await this.tenantPrisma.run(async (tx) => {
      const booking = await this.folios.loadBooking(tx, bookingId);
      if (booking.status !== RoomBookingStatus.CHECKED_IN)
        throw new ConflictException(
          'Only a guest who is checked in can be moved',
        );
      const current = await tx.hotelRoomAssignment.findFirst({
        where: { bookingId, roomId: dto.fromRoomId, toAt: null },
      });
      if (!current)
        throw new NotFoundException('The guest is not in that room');
      const target = await tx.hotelRoom.findUnique({
        where: { id: dto.toRoomId },
      });
      if (!target || !target.isActive)
        throw new NotFoundException('Room not found');
      if (target.roomTypeId !== booking.roomTypeId)
        throw new BadRequestException(
          `Room ${target.number} is a different type from the booking`,
        );
      const claimed = await tx.hotelRoom.updateMany({
        where: { id: target.id, status: 'VACANT_CLEAN' },
        data: { status: 'OCCUPIED' },
      });
      if (claimed.count === 0)
        throw new ConflictException(
          `Room ${target.number} is not vacant and clean`,
        );

      await tx.hotelRoomAssignment.update({
        where: { id: current.id },
        data: { toAt: new Date() },
      });
      await tx.hotelRoomAssignment.create({
        data: {
          bookingId,
          roomId: target.id,
          movedBy: orgUserId,
          reason: dto.reason,
        },
      });
      await tx.hotelRoom.update({
        where: { id: dto.fromRoomId },
        data: { status: 'VACANT_DIRTY' },
      });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.room_moved',
        entityType: 'RoomBooking',
        entityId: bookingId,
        before: { roomId: dto.fromRoomId },
        after: { roomId: target.id, number: target.number, reason: dto.reason },
      });
    });
    return this.desk.detail(bookingId);
  }

  // ── Check-out ─────────────────────────────────────────────────────────

  /** The front-desk "terminal" and the acting user's session on it - what a sale needs, though nobody is at a till. */
  private async deskTill(tx: TenantTx, branchId: string, orgUserId: string) {
    let terminal = await tx.terminal.findFirst({
      where: { branchId, deviceLabel: FRONT_DESK_TERMINAL_LABEL },
    });
    if (!terminal)
      terminal = await tx.terminal.create({
        data: { branchId, deviceLabel: FRONT_DESK_TERMINAL_LABEL },
      });
    let session = await tx.cashierSession.findFirst({
      where: { terminalId: terminal.id, orgUserId, pinEndedAt: null },
    });
    if (!session)
      session = await tx.cashierSession.create({
        data: { terminalId: terminal.id, orgUserId },
      });
    return { terminalId: terminal.id, cashierSessionId: session.id };
  }

  /**
   * Checks the guest out. Takes any payments given, then needs the folio at zero - or a manager approving the balance with a
   * reason. Then makes the settlement sale (once, whatever happens: its id comes from the booking) and frees the rooms.
   */
  async checkOut(bookingId: string, dto: CheckOutDto) {
    const { organizationId, orgUserId, role } = getTenantStore();

    // 1. Money in, balance check, and everything the sale needs.
    const plan = await this.tenantPrisma.run(async (tx) => {
      const booking = await this.folios.loadBooking(tx, bookingId);
      if (
        booking.status === RoomBookingStatus.CHECKED_OUT &&
        booking.settlementSaleId
      )
        return { done: true as const, booking };
      if (booking.status !== RoomBookingStatus.CHECKED_IN)
        throw new ConflictException(
          `This booking is ${booking.status.toLowerCase().replace('_', ' ')}, so it cannot be checked out`,
        );

      let folio = await this.folios.ensureFolio(tx, booking);
      await this.folios.reconcileCharges(tx, folio, booking);
      for (const p of dto.payments ?? []) {
        if (p.method === 'MPESA_RECEIPT' && !p.reference)
          throw new BadRequestException('Enter the M-Pesa receipt code');
        if (
          p.reference &&
          (await tx.hotelFolioEntry.findFirst({
            where: {
              method: p.method as PaymentMethod,
              reference: p.reference,
              type: 'PAYMENT',
            },
          }))
        )
          throw new ConflictException('That receipt has already been recorded');
        await tx.hotelFolioEntry.create({
          data: {
            folioId: folio.id,
            type: 'PAYMENT',
            amount: p.amount,
            description: 'Payment at check-out',
            method: p.method as PaymentMethod,
            reference: p.reference || null,
            shiftId: p.shiftId ?? dto.shiftId,
            createdById: orgUserId,
          },
        });
      }
      folio = await tx.hotelFolio.findUniqueOrThrow({
        where: { id: folio.id },
        include: { entries: true },
      });
      const totals = this.folios.summary(folio.entries);
      const problem = checkOutProblem(
        totals.balance,
        role,
        dto.leaveBalanceReason,
      );
      if (problem)
        throw new (
          dto.leaveBalanceReason && !isManagerOrAbove(role)
            ? ForbiddenException
            : ConflictException
        )(problem);

      const roomType = await tx.hotelRoomType.findUniqueOrThrow({
        where: { id: booking.roomTypeId },
      });
      const { variantId, taxRate } = await roomTaxRate(
        tx,
        organizationId,
        roomType,
      );
      const adjustments = folio.entries.filter((e) => e.type === 'ADJUSTMENT');
      const discount = roundMoney(
        -adjustments.reduce((s, e) => s + Number(e.amount), 0),
      );
      const quantity = booking.nights * booking.rooms;
      const rate = Number(booking.pricePerNight);
      const total = settlementTotal(rate, quantity, taxRate, discount);

      const payments = netPayments(
        folio.entries
          .filter((e) => e.type === 'PAYMENT')
          .map((e) => ({
            id: e.id,
            method: e.method as string,
            amount: Number(e.amount),
            reference: e.reference,
            createdAt: e.createdAt,
          })),
        totals.refunds,
      );
      const { allocations, unpaid } = allocateToSettlement(total, payments);

      const assignment = await tx.hotelRoomAssignment.findFirst({
        where: { bookingId },
        include: { room: { select: { branchId: true } } },
        orderBy: { fromAt: 'asc' },
      });
      const branch =
        assignment?.room.branchId ??
        dto.branchId ??
        (await tx.branch.findFirstOrThrow({ orderBy: { createdAt: 'asc' } }))
          .id;
      const till = await this.deskTill(tx, branch, orgUserId);
      const approver =
        adjustments.length > 0
          ? adjustments[adjustments.length - 1].createdById
          : orgUserId;
      return {
        done: false as const,
        booking,
        branch,
        till,
        variantId,
        quantity,
        rate,
        discount,
        total,
        allocations,
        unpaid,
        approver,
        balance: totals.balance,
      };
    });

    // 2. The room revenue, as one ordinary sale (never twice: the id comes from the booking).
    let saleId: string;
    if (plan.done) {
      saleId = plan.booking.settlementSaleId!;
    } else {
      const sale = await this.sales.create(
        {
          clientId: settlementClientId(bookingId),
          branchId: plan.branch,
          terminalId: plan.till.terminalId,
          cashierSessionId: plan.till.cashierSessionId,
          lineItems: [{ variantId: plan.variantId, quantity: plan.quantity }],
          payments: [
            ...plan.allocations.map((a) => ({
              method: a.method as PaymentMethod,
              amount: a.amount,
              providerReference:
                a.method === 'MPESA_RECEIPT'
                  ? (a.reference ?? undefined)
                  : undefined,
            })),
            ...(plan.unpaid > 0.004
              ? [
                  {
                    method: 'ROOM_CHARGE' as PaymentMethod,
                    amount: plan.unpaid,
                    providerReference: settlementReference(bookingId),
                  },
                ]
              : []),
          ],
          discount:
            plan.discount > 0
              ? {
                  type: 'FIXED' as const,
                  value: plan.discount,
                  approvedById: plan.approver,
                }
              : undefined,
        },
        {
          priceOverrides: { [plan.variantId]: plan.rate },
          noStockVariantIds: [plan.variantId],
          trustedRoomCharge: true,
        },
      );
      saleId = sale.id;
    }

    // 3. Close the stay: free the rooms, record commission (marketplace bookings only), link the sale.
    await this.tenantPrisma.run(async (tx) => {
      const booking = await this.folios.loadBooking(tx, bookingId);
      if (booking.status === RoomBookingStatus.CHECKED_IN) {
        const done = await tx.roomBooking.updateMany({
          where: { id: bookingId, status: RoomBookingStatus.CHECKED_IN },
          data: {
            status: RoomBookingStatus.CHECKED_OUT,
            checkedOutAt: new Date(),
            settlementSaleId: saleId,
            balanceLeftReason: dto.leaveBalanceReason || null,
            // ZARODA commission is only for bookings that came through the marketplace.
            commissionAmount:
              booking.source === 'MARKETPLACE' && booking.paidAt
                ? roundMoney(
                    Number(booking.total) * Number(booking.commissionRate),
                  )
                : 0,
          },
        });
        if (done.count > 0) {
          const open = await tx.hotelRoomAssignment.findMany({
            where: { bookingId, toAt: null },
          });
          await tx.hotelRoomAssignment.updateMany({
            where: { id: { in: open.map((a) => a.id) } },
            data: { toAt: new Date() },
          });
          await tx.hotelRoom.updateMany({
            where: {
              id: { in: open.map((a) => a.roomId) },
              status: 'OCCUPIED',
            },
            data: { status: 'VACANT_DIRTY' },
          });
          await this.auditLog.logInTx(tx, {
            action: 'hotel.check_out',
            entityType: 'RoomBooking',
            entityId: bookingId,
            after: {
              saleId,
              balanceLeft: plan.done ? null : plan.balance,
              reason: dto.leaveBalanceReason ?? null,
            },
          });
        }
      }
    });
    return {
      booking: await this.desk.detail(bookingId),
      folio: await this.folios.view(bookingId),
      saleId,
    };
  }
}
