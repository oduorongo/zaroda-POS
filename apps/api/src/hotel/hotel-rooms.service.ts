import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoomBookingStatus } from '@prisma/client';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, looksLikeImage } from '../catalog/product-images.service';
import { roundMoney } from '../online-orders/online-orders.util';
import { CancelBookingDto, UpsertRoomTypeDto } from './dto/hotel.dto';
import { bookingHoldsRooms, eachNight, roomsTaken, todayInKenya } from './room-availability.util';

export const MAX_ROOM_PHOTOS = 8;
export const roomPhotoPrefix = (organizationId: string, roomTypeId: string) => `orgs/${organizationId}/rooms/${roomTypeId}/`;

const BOOKING_PAGE = 300;

/** What a hotel's staff do: set up room types and photos, see bookings, check guests in and out. */
@Injectable()
export class HotelRoomsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  // ── Room types ────────────────────────────────────────────────────────

  private view(r: {
    id: string;
    name: string;
    description: string | null;
    amenities: string | null;
    pricePerNight: Prisma.Decimal;
    maxGuests: number;
    quantity: number;
    depositPercent: number;
    isListed: boolean;
    isActive: boolean;
    photos: { id: string; storageKey: string; sortOrder: number }[];
  }) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      amenities: r.amenities,
      pricePerNight: Number(r.pricePerNight),
      maxGuests: r.maxGuests,
      quantity: r.quantity,
      depositPercent: r.depositPercent,
      isListed: r.isListed,
      isActive: r.isActive,
      photos: [...r.photos].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => ({ id: p.id, url: this.storage.publicUrl(p.storageKey), sortOrder: p.sortOrder })),
    };
  }

  async listRoomTypes() {
    const rows = await this.tenantPrisma.run((tx) => tx.hotelRoomType.findMany({ include: { photos: true }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }));
    return rows.map((r) => this.view(r));
  }

  private async requireRoomType(tx: TenantTx, id: string) {
    const roomType = await tx.hotelRoomType.findUnique({ where: { id }, include: { photos: true } });
    if (!roomType) throw new NotFoundException('Room type not found');
    return roomType;
  }

  async createRoomType(dto: UpsertRoomTypeDto) {
    const { organizationId } = getTenantStore();
    const created = await this.tenantPrisma.run((tx) =>
      tx.hotelRoomType.create({
        data: {
          organizationId,
          name: dto.name,
          description: dto.description || null,
          amenities: dto.amenities || null,
          pricePerNight: dto.pricePerNight,
          maxGuests: dto.maxGuests,
          quantity: dto.quantity,
          depositPercent: dto.depositPercent,
          isListed: dto.isListed ?? false,
          isActive: dto.isActive ?? true,
        },
        include: { photos: true },
      }),
    );
    return this.view(created);
  }

  async updateRoomType(id: string, dto: UpsertRoomTypeDto) {
    const updated = await this.tenantPrisma.run(async (tx) => {
      await this.requireRoomType(tx, id);
      return tx.hotelRoomType.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description || null,
          amenities: dto.amenities || null,
          pricePerNight: dto.pricePerNight,
          maxGuests: dto.maxGuests,
          quantity: dto.quantity,
          depositPercent: dto.depositPercent,
          ...(dto.isListed !== undefined ? { isListed: dto.isListed } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive, ...(dto.isActive ? {} : { isListed: false }) } : {}),
        },
        include: { photos: true },
      });
    });
    return this.view(updated);
  }

  /** A room type with bookings is archived (hidden, history kept); one without is removed with its photos. */
  async removeRoomType(id: string) {
    const result = await this.tenantPrisma.run(async (tx) => {
      const roomType = await this.requireRoomType(tx, id);
      if ((await tx.roomBooking.count({ where: { roomTypeId: id } })) > 0) {
        await tx.hotelRoomType.update({ where: { id }, data: { isActive: false, isListed: false } });
        return { archived: true, keys: [] as string[] };
      }
      await tx.hotelRoomType.delete({ where: { id } });
      return { archived: false, keys: roomType.photos.map((p) => p.storageKey) };
    });
    await this.storage.deleteMany(result.keys);
    return { archived: result.archived };
  }

  // ── Photos ────────────────────────────────────────────────────────────

  async addPhoto(id: string, contentType: string, body: Buffer) {
    const { organizationId } = getTenantStore();
    const extension = IMAGE_CONTENT_TYPES[contentType];
    if (!extension) throw new BadRequestException('Photos must be JPEG, PNG or WebP');
    if (body.length === 0) throw new BadRequestException('The photo is empty');
    if (body.length > MAX_IMAGE_BYTES) throw new BadRequestException('Photos must be 5MB or smaller');
    if (!looksLikeImage(contentType, body)) throw new BadRequestException('That file is not a valid JPEG, PNG or WebP photo');

    await this.tenantPrisma.run(async (tx) => {
      await this.requireRoomType(tx, id);
      if ((await tx.hotelRoomPhoto.count({ where: { roomTypeId: id } })) >= MAX_ROOM_PHOTOS) {
        throw new BadRequestException(`A room type can have at most ${MAX_ROOM_PHOTOS} photos`);
      }
    });
    const key = `${roomPhotoPrefix(organizationId, id)}${randomUUID()}.${extension}`;
    await this.storage.upload(key, body, contentType);
    try {
      const photo = await this.tenantPrisma.run(async (tx) => {
        await this.requireRoomType(tx, id);
        const existing = await tx.hotelRoomPhoto.findMany({ where: { roomTypeId: id }, select: { sortOrder: true } });
        if (existing.length >= MAX_ROOM_PHOTOS) throw new BadRequestException(`A room type can have at most ${MAX_ROOM_PHOTOS} photos`);
        const next = existing.reduce((max, p) => Math.max(max, p.sortOrder + 1), 0);
        return tx.hotelRoomPhoto.create({ data: { roomTypeId: id, storageKey: key, sortOrder: next } });
      });
      return { id: photo.id, url: this.storage.publicUrl(photo.storageKey), sortOrder: photo.sortOrder };
    } catch (e) {
      await this.storage.deleteMany([key]);
      throw e;
    }
  }

  async makeCover(id: string, photoId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.requireRoomType(tx, id);
      const photos = await tx.hotelRoomPhoto.findMany({ where: { roomTypeId: id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
      const target = photos.find((p) => p.id === photoId);
      if (!target) throw new NotFoundException('Photo not found');
      const ordered = [target, ...photos.filter((p) => p.id !== photoId)];
      for (const [index, photo] of ordered.entries()) {
        if (photo.sortOrder !== index) await tx.hotelRoomPhoto.update({ where: { id: photo.id }, data: { sortOrder: index } });
      }
      return ordered.map((p, index) => ({ id: p.id, url: this.storage.publicUrl(p.storageKey), sortOrder: index }));
    });
  }

  async removePhoto(id: string, photoId: string) {
    const photo = await this.tenantPrisma.run(async (tx) => {
      await this.requireRoomType(tx, id);
      const found = await tx.hotelRoomPhoto.findFirst({ where: { id: photoId, roomTypeId: id } });
      if (!found) throw new NotFoundException('Photo not found');
      await tx.hotelRoomPhoto.delete({ where: { id: photoId } });
      return found;
    });
    await this.storage.deleteMany([photo.storageKey]);
  }

  // ── Bookings ──────────────────────────────────────────────────────────

  private bookingView(b: {
    id: string;
    bookingNumber: string;
    status: RoomBookingStatus;
    guestName: string;
    guestPhone: string;
    guestEmail: string | null;
    guests: number;
    rooms: number;
    checkIn: Date;
    checkOut: Date;
    nights: number;
    notes: string | null;
    roomTypeName: string;
    total: Prisma.Decimal;
    depositAmount: number;
    paidAt: Date | null;
    mpesaReceiptNumber: string | null;
    lastPaymentError: string | null;
    paymentDeadline: Date;
    cancelReason: string | null;
    createdAt: Date;
  }) {
    const total = Number(b.total);
    const unpaidExpired = b.status === 'PENDING_PAYMENT' && b.paymentDeadline <= new Date();
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: unpaidExpired ? 'EXPIRED' : b.status,
      guestName: b.guestName,
      guestPhone: b.guestPhone,
      guestEmail: b.guestEmail,
      guests: b.guests,
      rooms: b.rooms,
      checkIn: b.checkIn.toISOString().slice(0, 10),
      checkOut: b.checkOut.toISOString().slice(0, 10),
      nights: b.nights,
      notes: b.notes,
      roomTypeName: b.roomTypeName,
      total,
      depositPaid: b.paidAt ? b.depositAmount : 0,
      depositAmount: b.depositAmount,
      balanceDue: roundMoney(total - (b.paidAt ? b.depositAmount : 0)),
      mpesaReceiptNumber: b.mpesaReceiptNumber,
      lastPaymentError: b.lastPaymentError,
      cancelReason: b.cancelReason,
      createdAt: b.createdAt,
    };
  }

  /** Current and upcoming bookings by default (check-out today or later), soonest arrival first. */
  async listBookings(filter: { status?: RoomBookingStatus; includePast?: boolean }) {
    const today = todayInKenya();
    const rows = await this.tenantPrisma.run((tx) =>
      tx.roomBooking.findMany({
        where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.includePast ? {} : { checkOut: { gte: today } }) },
        orderBy: [{ checkIn: 'asc' }, { createdAt: 'asc' }],
        take: BOOKING_PAGE,
      }),
    );
    return rows.map((b) => this.bookingView(b));
  }

  private async transition(id: string, from: RoomBookingStatus[], data: Prisma.RoomBookingUncheckedUpdateManyInput | ((b: { depositAmount: number; commissionRate: Prisma.Decimal; paidAt: Date | null }) => Prisma.RoomBookingUncheckedUpdateManyInput)) {
    const updated = await this.tenantPrisma.run(async (tx) => {
      const booking = await tx.roomBooking.findUnique({ where: { id } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (!from.includes(booking.status)) throw new BadRequestException(`This booking is ${booking.status.toLowerCase().replace('_', ' ')} - that action is not available`);
      const result = await tx.roomBooking.updateMany({ where: { id, status: booking.status }, data: typeof data === 'function' ? data(booking) : data });
      if (result.count === 0) throw new ConflictException('This booking was just updated by someone else - refresh');
      return tx.roomBooking.findUniqueOrThrow({ where: { id } });
    });
    return this.bookingView(updated);
  }

  checkIn(id: string) {
    return this.transition(id, [RoomBookingStatus.CONFIRMED], { status: RoomBookingStatus.CHECKED_IN, checkedInAt: new Date() });
  }

  /** The guest leaves. The commission on what was paid online is recorded now and billed on the hotel's next monthly commission invoice. */
  checkOut(id: string) {
    return this.transition(id, [RoomBookingStatus.CHECKED_IN], (b) => ({
      status: RoomBookingStatus.CHECKED_OUT,
      checkedOutAt: new Date(),
      commissionAmount: b.paidAt ? roundMoney(b.depositAmount * Number(b.commissionRate)) : 0,
    }));
  }

  noShow(id: string) {
    return this.transition(id, [RoomBookingStatus.CONFIRMED], { status: RoomBookingStatus.NO_SHOW });
  }

  /** The hotel cancels. If the deposit was paid it sits in the hotel's own account, so the hotel must refund it. */
  async cancel(id: string, dto: CancelBookingDto) {
    const view = await this.transition(id, [RoomBookingStatus.PENDING_PAYMENT, RoomBookingStatus.CONFIRMED], {
      status: RoomBookingStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelReason: dto.reason.trim(),
    });
    return { ...view, refundDue: view.depositPaid };
  }

  /** Free rooms per night per room type for the next `days` days - the hotel's at-a-glance calendar. */
  async availability(fromInput: Date | null, days: number) {
    const from = fromInput ?? todayInKenya();
    const span = Math.min(Math.max(days, 1), 31);
    const to = new Date(from.getTime() + span * 86_400_000);
    const now = new Date();
    const { roomTypes, bookings } = await this.tenantPrisma.run(async (tx) => ({
      roomTypes: await tx.hotelRoomType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      bookings: await tx.roomBooking.findMany({
        where: { checkIn: { lt: to }, checkOut: { gt: from }, status: { in: [RoomBookingStatus.CONFIRMED, RoomBookingStatus.CHECKED_IN, RoomBookingStatus.PENDING_PAYMENT] } },
      }),
    }));
    const held = bookings.filter((b) => bookingHoldsRooms(b, now));
    const nights = eachNight(from, to);
    return {
      from: from.toISOString().slice(0, 10),
      nights: nights.map((n) => n.toISOString().slice(0, 10)),
      roomTypes: roomTypes.map((rt) => {
        const mine = held.filter((b) => b.roomTypeId === rt.id);
        return {
          id: rt.id,
          name: rt.name,
          quantity: rt.quantity,
          free: nights.map((n) => rt.quantity - roomsTaken(mine, n, new Date(n.getTime() + 86_400_000))),
        };
      }),
    };
  }
}
