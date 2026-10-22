import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HotelRoom,
  HotelRoomStatus,
  Prisma,
  RoomBookingStatus,
} from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import {
  BulkRoomsDto,
  CreateRoomDto,
  SetRoomStatusDto,
  UpdateRoomDto,
} from './dto/front-desk.dto';
import {
  isSupervisorOrAbove,
  quantityFor,
  roomStatusProblem,
} from './folio.util';

/** Keeps a room type's quantity equal to its active rooms (once it has any), so marketplace availability stays right. */
export async function syncRoomTypeQuantity(
  tx: TenantTx,
  roomTypeId: string,
): Promise<void> {
  const [roomType, active] = await Promise.all([
    tx.hotelRoomType.findUnique({ where: { id: roomTypeId } }),
    tx.hotelRoom.count({ where: { roomTypeId, isActive: true } }),
  ]);
  if (!roomType) return;
  const quantity = quantityFor(active, roomType.quantity);
  if (quantity !== roomType.quantity)
    await tx.hotelRoomType.update({
      where: { id: roomTypeId },
      data: { quantity },
    });
}

/**
 * The product a room type's nights are sold as when a stay is settled ("Room: Deluxe"): created on first need, kept in step with
 * the room type's name and price. The hotel sets its tax class on the Products screen like any product.
 */
export async function ensureRoomProduct(
  tx: TenantTx,
  organizationId: string,
  roomType: {
    id: string;
    name: string;
    pricePerNight: Prisma.Decimal | number;
    variantId: string | null;
  },
): Promise<string> {
  const price = Number(roomType.pricePerNight);
  if (roomType.variantId) {
    const variant = await tx.productVariant.findUnique({
      where: { id: roomType.variantId },
    });
    if (variant) {
      await tx.product.update({
        where: { id: variant.productId },
        data: { name: `Room: ${roomType.name}` },
      });
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { price },
      });
      return variant.id;
    }
  }
  const product = await tx.product.create({
    data: {
      organizationId,
      name: `Room: ${roomType.name}`,
      variants: {
        create: {
          sku: `ROOM-${roomType.id.slice(0, 8).toUpperCase()}`,
          price,
          quantityMode: 'COUNT',
        },
      },
    },
    include: { variants: true },
  });
  const variantId = product.variants[0].id;
  await tx.hotelRoomType.update({
    where: { id: roomType.id },
    data: { variantId },
  });
  return variantId;
}

const BULK_MAX = 100;

/** The hotel's real rooms: adding them, and the housekeeping status of each. */
@Injectable()
export class PhysicalRoomsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private view(
    r: HotelRoom & {
      roomType: { name: string };
      assignments?: {
        booking: {
          id: string;
          bookingNumber: string;
          guestName: string;
          checkOut: Date;
        };
      }[];
    },
  ) {
    const guest = r.assignments?.[0]?.booking;
    return {
      id: r.id,
      number: r.number,
      floor: r.floor,
      status: r.status,
      notes: r.notes,
      isActive: r.isActive,
      branchId: r.branchId,
      roomTypeId: r.roomTypeId,
      roomTypeName: r.roomType.name,
      guest: guest
        ? {
            bookingId: guest.id,
            bookingNumber: guest.bookingNumber,
            name: guest.guestName,
            checkOut: guest.checkOut.toISOString().slice(0, 10),
          }
        : null,
    };
  }

  private async defaultBranch(
    tx: TenantTx,
    branchId?: string,
  ): Promise<string> {
    const branch = branchId
      ? await tx.branch.findUnique({ where: { id: branchId } })
      : await tx.branch.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch.id;
  }

  private duplicate(number: string): never {
    throw new ConflictException(`Room ${number} already exists at this branch`);
  }

  /** Rooms with who is in them now - the housekeeping board and the front desk's room grid. */
  async list(
    filter: {
      roomTypeId?: string;
      status?: HotelRoomStatus;
      includeInactive?: boolean;
    } = {},
  ) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.hotelRoom.findMany({
        where: {
          roomTypeId: filter.roomTypeId,
          status: filter.status,
          ...(filter.includeInactive ? {} : { isActive: true }),
        },
        include: {
          roomType: { select: { name: true } },
          assignments: {
            where: {
              toAt: null,
              booking: { status: RoomBookingStatus.CHECKED_IN },
            },
            select: {
              booking: {
                select: {
                  id: true,
                  bookingNumber: true,
                  guestName: true,
                  checkOut: true,
                },
              },
            },
            take: 1,
          },
        },
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        take: 1000,
      }),
    );
    return rows.map((r) => this.view(r));
  }

  async create(dto: CreateRoomDto) {
    const { organizationId } = getTenantStore();
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const roomType = await tx.hotelRoomType.findUnique({
          where: { id: dto.roomTypeId },
        });
        if (!roomType) throw new NotFoundException('Room type not found');
        const branchId = await this.defaultBranch(tx, dto.branchId);
        const room = await tx.hotelRoom.create({
          data: {
            organizationId,
            branchId,
            roomTypeId: dto.roomTypeId,
            number: dto.number,
            floor: dto.floor || null,
            notes: dto.notes || null,
          },
          include: { roomType: { select: { name: true } } },
        });
        await syncRoomTypeQuantity(tx, dto.roomTypeId);
        await this.auditLog.logInTx(tx, {
          action: 'hotel.room_added',
          entityType: 'HotelRoom',
          entityId: room.id,
          after: { number: room.number, roomTypeId: room.roomTypeId },
        });
        return this.view(room);
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        this.duplicate(dto.number);
      throw e;
    }
  }

  /** Adds a run of rooms at once: 101 to 110, or A1 to A12 (a prefix and a number range). */
  async createMany(dto: BulkRoomsDto) {
    const { organizationId } = getTenantStore();
    if (dto.to < dto.from)
      throw new BadRequestException(
        'The last room number must not be below the first',
      );
    if (dto.to - dto.from + 1 > BULK_MAX)
      throw new BadRequestException(`Add at most ${BULK_MAX} rooms at once`);
    const numbers = Array.from(
      { length: dto.to - dto.from + 1 },
      (_, i) => `${dto.prefix ?? ''}${dto.from + i}`,
    );
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const roomType = await tx.hotelRoomType.findUnique({
          where: { id: dto.roomTypeId },
        });
        if (!roomType) throw new NotFoundException('Room type not found');
        const branchId = await this.defaultBranch(tx, dto.branchId);
        const clash = await tx.hotelRoom.findMany({
          where: { branchId, number: { in: numbers } },
          select: { number: true },
        });
        if (clash.length > 0)
          throw new ConflictException(
            `Already exist: ${clash.map((c) => c.number).join(', ')}`,
          );
        await tx.hotelRoom.createMany({
          data: numbers.map((number) => ({
            organizationId,
            branchId,
            roomTypeId: dto.roomTypeId,
            number,
            floor: dto.floor || null,
          })),
        });
        await syncRoomTypeQuantity(tx, dto.roomTypeId);
        await this.auditLog.logInTx(tx, {
          action: 'hotel.rooms_added',
          entityType: 'HotelRoomType',
          entityId: dto.roomTypeId,
          after: { numbers },
        });
        return { added: numbers.length, numbers };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('One of those room numbers already exists');
      throw e;
    }
  }

  async update(id: string, dto: UpdateRoomDto) {
    try {
      return await this.tenantPrisma.run(async (tx) => {
        const room = await tx.hotelRoom.findUnique({ where: { id } });
        if (!room) throw new NotFoundException('Room not found');
        if (
          room.status === HotelRoomStatus.OCCUPIED &&
          (dto.isActive === false ||
            (dto.roomTypeId && dto.roomTypeId !== room.roomTypeId))
        ) {
          throw new ConflictException(
            'A guest is in this room. Check them out or move them first.',
          );
        }
        if (
          dto.roomTypeId &&
          !(await tx.hotelRoomType.findUnique({
            where: { id: dto.roomTypeId },
          }))
        )
          throw new NotFoundException('Room type not found');
        const updated = await tx.hotelRoom.update({
          where: { id },
          data: {
            number: dto.number,
            floor: dto.floor === undefined ? undefined : dto.floor || null,
            notes: dto.notes === undefined ? undefined : dto.notes || null,
            roomTypeId: dto.roomTypeId,
            isActive: dto.isActive,
          },
          include: { roomType: { select: { name: true } } },
        });
        await syncRoomTypeQuantity(tx, updated.roomTypeId);
        if (room.roomTypeId !== updated.roomTypeId)
          await syncRoomTypeQuantity(tx, room.roomTypeId);
        await this.auditLog.logInTx(tx, {
          action: 'hotel.room_updated',
          entityType: 'HotelRoom',
          entityId: id,
          before: {
            number: room.number,
            roomTypeId: room.roomTypeId,
            isActive: room.isActive,
          },
          after: {
            number: updated.number,
            roomTypeId: updated.roomTypeId,
            isActive: updated.isActive,
          },
        });
        return this.view(updated);
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        this.duplicate(dto.number ?? '');
      throw e;
    }
  }

  /** Housekeeping: clean, dirty, or out of order. Occupied is only ever set by a check-in. */
  async setStatus(id: string, dto: SetRoomStatusDto) {
    const { role } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const room = await tx.hotelRoom.findUnique({ where: { id } });
      if (!room || !room.isActive)
        throw new NotFoundException('Room not found');
      const problem = roomStatusProblem(role, room.status, dto.status);
      if (problem)
        throw new (
          isSupervisorOrAbove(role) ? BadRequestException : ForbiddenException
        )(problem);
      const res = await tx.hotelRoom.updateMany({
        where: { id, status: room.status },
        data: { status: dto.status },
      });
      if (res.count === 0)
        throw new ConflictException(
          'This room was just changed by someone else - refresh',
        );
      await this.auditLog.logInTx(tx, {
        action: 'hotel.room_status',
        entityType: 'HotelRoom',
        entityId: id,
        before: { status: room.status },
        after: { status: dto.status, note: dto.note ?? null },
      });
      const updated = await tx.hotelRoom.findUniqueOrThrow({
        where: { id },
        include: { roomType: { select: { name: true } } },
      });
      return this.view(updated);
    });
  }
}
