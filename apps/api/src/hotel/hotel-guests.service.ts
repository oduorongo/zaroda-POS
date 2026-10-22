import { createHmac } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HotelGuest } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
} from '../common/crypto/secret-box';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { GuestLookupDto, UpdateGuestDto } from './dto/hotel-ops.dto';
import { isSupervisorOrAbove } from './folio.util';
import { guestPhone, maskId } from './guest-format';

/** What the desk knows about a person who is booking, as typed on the booking form. */
export interface GuestDetails {
  fullName: string;
  phone: string;
  email?: string | null;
  idNumber?: string | null;
  nationality?: string | null;
  address?: string | null;
  vehicleReg?: string | null;
  smsOptOut?: boolean;
}

/** An ID is compared ignoring case, spaces and dashes ("a 123-456" = "A123456"). */
export const normalizeId = (id: string): string =>
  id.toUpperCase().replace(/[\s-]/g, '');

/**
 * The guest register: one entry per person however many times they stay, found again by phone or ID number. The ID number is kept
 * encrypted (like the other secrets); the last four digits and a keyed hash for lookup sit beside it. Lists only ever show the last
 * four; the whole number is shown on the guest's own record to a supervisor or above.
 */
@Injectable()
export class HotelGuestsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  private key(): Buffer {
    return parseEncryptionKey(
      this.config.get<string>('SECRETS_ENCRYPTION_KEY'),
    );
  }

  private hashOf(id: string): string {
    return createHmac('sha256', this.key())
      .update(`hotel-guest-id:${normalizeId(id)}`)
      .digest('hex');
  }

  private idFields(idNumber: string | null | undefined) {
    const id = idNumber?.trim();
    if (!id) return {};
    return {
      idNumberEnc: encryptSecret(id, this.key()),
      idLast4: normalizeId(id).slice(-4),
      idHash: this.hashOf(id),
    };
  }

  /**
   * Finds the guest this booking is for, or adds them: by the guest the desk picked, else by ID number, else by the same phone AND
   * the same name. Blank details on an existing record are filled in; details already there are not overwritten by a booking.
   */
  async upsertInTx(
    tx: TenantTx,
    organizationId: string,
    d: GuestDetails,
    pickedId?: string,
  ): Promise<HotelGuest> {
    const phone = guestPhone(d.phone) ?? d.phone;
    let guest: HotelGuest | null = pickedId
      ? await tx.hotelGuest.findUnique({ where: { id: pickedId } })
      : null;
    if (pickedId && !guest)
      throw new NotFoundException('That guest was not found');
    const id = d.idNumber?.trim();
    if (!guest && id)
      guest = await tx.hotelGuest.findFirst({
        where: { idHash: this.hashOf(id) },
      });
    if (!guest) {
      const sameName = await tx.hotelGuest.findMany({
        where: { phone },
        take: 20,
      });
      guest =
        sameName.find(
          (g) =>
            g.fullName.trim().toLowerCase() === d.fullName.trim().toLowerCase(),
        ) ?? null;
    }
    if (!guest)
      return tx.hotelGuest.create({
        data: {
          organizationId,
          fullName: d.fullName,
          phone,
          email: d.email || null,
          nationality: d.nationality || null,
          address: d.address || null,
          vehicleReg: d.vehicleReg || null,
          smsOptOut: d.smsOptOut ?? false,
          ...this.idFields(id),
        },
      });
    const fill: Record<string, unknown> = {};
    if (!guest.email && d.email) fill.email = d.email;
    if (!guest.nationality && d.nationality) fill.nationality = d.nationality;
    if (!guest.address && d.address) fill.address = d.address;
    if (!guest.vehicleReg && d.vehicleReg) fill.vehicleReg = d.vehicleReg;
    if (!guest.idHash && id) Object.assign(fill, this.idFields(id));
    if (d.smsOptOut === true && !guest.smsOptOut) fill.smsOptOut = true;
    if (guest.phone !== phone && pickedId) fill.phone = phone; // the desk picked this person and gave a newer number
    return Object.keys(fill).length > 0
      ? tx.hotelGuest.update({ where: { id: guest.id }, data: fill })
      : guest;
  }

  /** A guest as the register lists show them: ID masked to its last four. */
  private listView(g: HotelGuest & { _count?: { bookings: number } }) {
    return {
      id: g.id,
      fullName: g.fullName,
      phone: g.phone,
      email: g.email,
      idNumber: g.idLast4 ? `****${g.idLast4}` : null,
      nationality: g.nationality,
      vehicleReg: g.vehicleReg,
      smsOptOut: g.smsOptOut,
      stays: g._count?.bookings ?? undefined,
    };
  }

  /** Returning-guest lookup at the desk: by phone (any way it is typed) or by ID number. */
  async lookup(q: GuestLookupDto) {
    return this.tenantPrisma.run(async (tx) => {
      const found = new Map<
        string,
        HotelGuest & { _count: { bookings: number } }
      >();
      const include = { _count: { select: { bookings: true } } } as const;
      if (q.idNumber?.trim()) {
        const g = await tx.hotelGuest.findFirst({
          where: { idHash: this.hashOf(q.idNumber) },
          include,
        });
        if (g) found.set(g.id, g);
      }
      if (q.phone?.trim()) {
        const wanted = guestPhone(q.phone) ?? q.phone.trim();
        for (const g of await tx.hotelGuest.findMany({
          where: { phone: wanted },
          include,
          take: 10,
        }))
          found.set(g.id, g);
      }
      return [...found.values()].map((g) => this.listView(g));
    });
  }

  /** The register, newest first, searchable by name or phone. */
  async list(search?: string) {
    const s = search?.trim();
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.hotelGuest.findMany({
        where: s
          ? {
              OR: [
                { fullName: { contains: s, mode: 'insensitive' } },
                { phone: { contains: s.replace(/\s/g, '') } },
              ],
            }
          : {},
        include: { _count: { select: { bookings: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      return rows.map((g) => this.listView(g));
    });
  }

  /** One guest's own record with their stays; the whole ID number only for a supervisor or above. */
  async detail(id: string) {
    const { role } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const g = await tx.hotelGuest.findUnique({
        where: { id },
        include: { _count: { select: { bookings: true } } },
      });
      if (!g) throw new NotFoundException('Guest not found');
      const stays = await tx.roomBooking.findMany({
        where: { guestId: id },
        orderBy: { checkIn: 'desc' },
        take: 50,
        select: {
          id: true,
          bookingNumber: true,
          status: true,
          checkIn: true,
          checkOut: true,
          roomTypeName: true,
          total: true,
        },
      });
      return {
        ...this.listView(g),
        idNumber: g.idNumberEnc
          ? isSupervisorOrAbove(role)
            ? decryptSecret(g.idNumberEnc, this.key())
            : this.listView(g).idNumber
          : null,
        address: g.address,
        notes: g.notes,
        stays: stays.map((s) => ({
          id: s.id,
          bookingNumber: s.bookingNumber,
          status: s.status,
          checkIn: s.checkIn.toISOString().slice(0, 10),
          checkOut: s.checkOut.toISOString().slice(0, 10),
          roomTypeName: s.roomTypeName,
          total: Number(s.total),
        })),
      };
    });
  }

  async update(id: string, dto: UpdateGuestDto) {
    const data: Record<string, unknown> = {};
    for (const k of [
      'fullName',
      'email',
      'nationality',
      'address',
      'vehicleReg',
      'notes',
      'smsOptOut',
    ] as const)
      if (dto[k] !== undefined) data[k] = dto[k] === '' ? null : dto[k];
    if (dto.fullName) data.fullName = dto.fullName;
    if (dto.phone) data.phone = guestPhone(dto.phone) ?? dto.phone;
    if (dto.idNumber !== undefined)
      Object.assign(
        data,
        dto.idNumber
          ? this.idFields(dto.idNumber)
          : { idNumberEnc: null, idLast4: null, idHash: null },
      );
    await this.tenantPrisma.run(async (tx) => {
      const g = await tx.hotelGuest.findUnique({ where: { id } });
      if (!g) throw new NotFoundException('Guest not found');
      await tx.hotelGuest.update({ where: { id }, data });
      // the opt-out is also what the texts check on the booking
      if (dto.smsOptOut !== undefined)
        await tx.roomBooking.updateMany({
          where: { guestId: id },
          data: { smsOptOut: dto.smsOptOut },
        });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.guest_updated',
        entityType: 'HotelGuest',
        entityId: id,
        after: { ...dto, idNumber: dto.idNumber ? '(changed)' : undefined },
      });
    });
    return this.detail(id);
  }

  /** What is printed for a guest to sign when they check in. */
  async registrationCard(bookingId: string) {
    const { role, organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const b = await tx.roomBooking.findUnique({
        where: { id: bookingId },
        include: {
          guest: true,
          assignments: {
            where: { toAt: null },
            include: { room: { select: { number: true } } },
          },
        },
      });
      if (!b) throw new NotFoundException('Booking not found');
      const org = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, address: true, phone: true },
      });
      const g = b.guest;
      const fullId = g?.idNumberEnc
        ? decryptSecret(g.idNumberEnc, this.key())
        : b.idNumber;
      return {
        business: org,
        bookingNumber: b.bookingNumber,
        guestName: g?.fullName ?? b.guestName,
        phone: g?.phone ?? b.guestPhone,
        email: g?.email ?? b.guestEmail,
        idNumber: fullId
          ? isSupervisorOrAbove(role)
            ? fullId
            : maskId(normalizeId(fullId))
          : null,
        nationality: g?.nationality ?? b.nationality,
        address: g?.address ?? null,
        vehicleReg: g?.vehicleReg ?? null,
        roomTypeName: b.roomTypeName,
        roomNumbers: b.assignments.map((a) => a.room.number),
        rooms: b.rooms,
        adults: b.adults ?? b.guests,
        children: b.children,
        checkIn: b.checkIn.toISOString().slice(0, 10),
        checkOut: b.checkOut.toISOString().slice(0, 10),
        nights: b.nights,
        mealPlan: b.mealPlan,
        printedOn: new Date(),
      };
    });
  }
}
