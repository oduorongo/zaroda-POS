import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FolioEntryType,
  HotelFolio,
  HotelFolioEntry,
  PaymentMethod,
  RoomBooking,
  RoomBookingStatus,
} from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AdjustmentDto, PostPaymentDto, RefundDto } from './dto/front-desk.dto';
import { folioTotals } from './folio.util';
import { activeTaxLines, syncManagedTaxClass } from './hotel-tax-class';
import { netPerNight, readBreakdown } from './stay-pricing';
import { combinedRate, nightPostings, TaxLine } from './tax.util';
import { ensureRoomProduct } from './physical-rooms.service';
import { eachNight } from './room-availability.util';

type FolioWithEntries = HotelFolio & { entries: HotelFolioEntry[] };

export const entryView = (e: HotelFolioEntry) => ({
  id: e.id,
  type: e.type,
  amount: Number(e.amount),
  taxAmount: Number(e.taxAmount),
  taxBreakdown: (e.taxBreakdown ?? null) as Record<string, number> | null,
  description: e.description,
  nightDate: e.nightDate ? e.nightDate.toISOString().slice(0, 10) : null,
  method: e.method,
  reference: e.reference,
  saleId: e.saleId,
  createdAt: e.createdAt,
});

/** The VAT/levy rate on a room type's nights: the tax class of its "Room: ..." product, or none. */
export async function roomTaxRate(
  tx: TenantTx,
  organizationId: string,
  roomType: {
    id: string;
    name: string;
    pricePerNight: unknown;
    variantId: string | null;
  },
): Promise<{ variantId: string; taxRate: number; lines: TaxLine[] }> {
  const variantId = await ensureRoomProduct(tx, organizationId, {
    ...roomType,
    pricePerNight: Number(roomType.pricePerNight),
  });
  const variant = await tx.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    include: { product: { include: { taxClass: true } } },
  });
  // When the hotel has set its own room taxes, the room product carries their combined rate (so the sale at check-out is right).
  const lines = await activeTaxLines(tx);
  if (lines.length > 0) {
    const classId = await syncManagedTaxClass(tx, organizationId);
    if (classId && variant.product.taxClassId !== classId)
      await tx.product.update({ where: { id: variant.productId }, data: { taxClassId: classId } });
    return { variantId, taxRate: combinedRate(lines), lines };
  }
  const tc = variant.product.taxClass;
  const taxRate = tc && !tc.isExempt ? Number(tc.rate) : 0;
  return { variantId, taxRate, lines: taxRate > 0 ? [{ name: tc?.name ?? 'Tax', percent: Math.round(taxRate * 10000) / 100 }] : [] };
}

/**
 * A guest's folio: the running account of a stay. Entries are only ever added (a correction is a new entry). The deposit of a
 * marketplace booking, payments at the desk, the room nights and charges to the room all live here; at check-out the room nights
 * become one ordinary sale (see FrontDeskStayService) so room revenue reaches Sales, Reports, profit and tax.
 */
@Injectable()
export class HotelFolioService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** The folio of a booking, made if it does not exist yet. A paid marketplace deposit is posted as its first payment, once. */
  async ensureFolio(
    tx: TenantTx,
    booking: RoomBooking,
  ): Promise<FolioWithEntries> {
    let folio = await tx.hotelFolio.findUnique({
      where: { bookingId: booking.id },
      include: { entries: true },
    });
    if (!folio) {
      folio = await tx.hotelFolio.create({
        data: { organizationId: booking.organizationId, bookingId: booking.id },
        include: { entries: true },
      });
    }
    if (
      booking.source === 'MARKETPLACE' &&
      booking.paidAt &&
      booking.depositAmount > 0 &&
      booking.mpesaReceiptNumber
    ) {
      const posted = folio.entries.some(
        (e) =>
          e.type === 'PAYMENT' && e.reference === booking.mpesaReceiptNumber,
      );
      if (!posted) {
        const entry = await tx.hotelFolioEntry.create({
          data: {
            folioId: folio.id,
            type: 'PAYMENT',
            amount: booking.depositAmount,
            description: 'Deposit paid online',
            method: PaymentMethod.MPESA_RECEIPT,
            reference: booking.mpesaReceiptNumber,
            createdById: 'marketplace',
          },
        });
        folio = { ...folio, entries: [...folio.entries, entry] };
      }
    }
    return folio;
  }

  /** Posts the nights of a stay, once: one entry per night with the tax inside it. */
  async postNights(
    tx: TenantTx,
    booking: RoomBooking,
    folio: FolioWithEntries,
    createdById: string,
  ): Promise<FolioWithEntries> {
    if (folio.nightsPostedAt) return folio;
    const roomType = await tx.hotelRoomType.findUniqueOrThrow({
      where: { id: booking.roomTypeId },
    });
    const { lines } = await roomTaxRate(tx, booking.organizationId, roomType);
    const nights = eachNight(booking.checkIn, booking.checkOut);
    const amounts = nightPostings(
      netPerNight(readBreakdown(booking.priceBreakdown), { rate: Number(booking.pricePerNight), rooms: booking.rooms, nights: nights.length }),
      lines,
    );
    const created: HotelFolioEntry[] = [];
    for (const [i, night] of nights.entries()) {
      created.push(
        await tx.hotelFolioEntry.create({
          data: {
            folioId: folio.id,
            type: 'ROOM_NIGHT',
            amount: amounts[i].amount,
            taxAmount: amounts[i].taxAmount,
            taxBreakdown: amounts[i].breakdown,
            description: `${booking.roomTypeName}${booking.rooms > 1 ? ` x${booking.rooms}` : ''} - ${night.toISOString().slice(0, 10)}`,
            nightDate: night,
            createdById,
          },
        }),
      );
    }
    const updated = await tx.hotelFolio.update({
      where: { id: folio.id },
      data: { nightsPostedAt: new Date() },
    });
    return { ...updated, entries: [...folio.entries, ...created] };
  }

  /**
   * After a stay has been changed: makes the room nights on the folio match the booking's new price, by adding the DIFFERENCE for
   * each night as a signed room-night entry (entries are never edited). Does nothing until the nights have been posted.
   */
  async syncRoomNights(tx: TenantTx, booking: RoomBooking, folio: FolioWithEntries, createdById: string, reason: string): Promise<number> {
    if (!folio.nightsPostedAt) return 0;
    const roomType = await tx.hotelRoomType.findUniqueOrThrow({ where: { id: booking.roomTypeId } });
    const { lines } = await roomTaxRate(tx, booking.organizationId, roomType);
    const nights = eachNight(booking.checkIn, booking.checkOut);
    const targets = nightPostings(
      netPerNight(readBreakdown(booking.priceBreakdown), { rate: Number(booking.pricePerNight), rooms: booking.rooms, nights: nights.length }),
      lines,
    );
    const cents = (n: number) => Math.round(n * 100);
    const have = new Map<string, { amount: number; tax: number; parts: Record<string, number> }>();
    for (const e of folio.entries.filter((x) => x.type === 'ROOM_NIGHT' && x.nightDate)) {
      const key = e.nightDate!.toISOString().slice(0, 10);
      const cur = have.get(key) ?? { amount: 0, tax: 0, parts: {} };
      cur.amount += cents(Number(e.amount));
      cur.tax += cents(Number(e.taxAmount));
      for (const [k, v] of Object.entries((e.taxBreakdown ?? {}) as Record<string, number>)) cur.parts[k] = (cur.parts[k] ?? 0) + cents(Number(v));
      have.set(key, cur);
    }
    const want = new Map(nights.map((n, i) => [n.toISOString().slice(0, 10), { date: n, ...targets[i] }]));
    let posted = 0;
    for (const key of [...new Set([...have.keys(), ...want.keys()])].sort()) {
      const h = have.get(key) ?? { amount: 0, tax: 0, parts: {} };
      const w = want.get(key);
      const dAmount = cents(w?.amount ?? 0) - h.amount;
      const dTax = cents(w?.taxAmount ?? 0) - h.tax;
      if (dAmount === 0 && dTax === 0) continue;
      const parts: Record<string, number> = {};
      for (const k of new Set([...Object.keys(h.parts), ...Object.keys(w?.breakdown ?? {})])) {
        const d = cents(w?.breakdown?.[k] ?? 0) - (h.parts[k] ?? 0);
        if (d !== 0) parts[k] = d / 100;
      }
      await tx.hotelFolioEntry.create({
        data: {
          folioId: folio.id,
          type: 'ROOM_NIGHT',
          amount: dAmount / 100,
          taxAmount: dTax / 100,
          taxBreakdown: parts,
          description: `Stay changed (${key}): ${reason}`,
          nightDate: new Date(`${key}T00:00:00Z`),
          createdById,
        },
      });
      posted += 1;
    }
    return posted;
  }

  /** Adds the folio CHARGE for any sale charged to this room whose own step did not land (see RoomChargeService). */
  async reconcileCharges(
    tx: TenantTx,
    folio: FolioWithEntries,
    booking: RoomBooking,
  ): Promise<void> {
    const payments = await tx.salePayment.findMany({
      where: {
        method: PaymentMethod.ROOM_CHARGE,
        providerReference: { startsWith: `ROOM:${booking.id}:` },
      },
      include: {
        sale: { select: { id: true, status: true, cashierOrgUserId: true } },
      },
    });
    const have = new Set(
      folio.entries.filter((e) => e.saleId).map((e) => e.saleId),
    );
    for (const p of payments) {
      if (p.sale.status !== 'COMPLETED' || have.has(p.saleId)) continue;
      await tx.hotelFolioEntry.create({
        data: {
          folioId: folio.id,
          type: 'CHARGE',
          amount: p.amount,
          description: 'Charged to room',
          saleId: p.saleId,
          createdById: p.sale.cashierOrgUserId ?? 'till',
        },
      });
    }
  }

  async loadBooking(tx: TenantTx, bookingId: string): Promise<RoomBooking> {
    const booking = await tx.roomBooking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** What the guest has been charged and has paid so far. */
  summary(entries: HotelFolioEntry[]) {
    return folioTotals(
      entries.map((e) => ({
        type: e.type,
        amount: Number(e.amount),
        taxAmount: Number(e.taxAmount),
      })),
    );
  }

  /** The folio as the front desk and the printout show it, with the business's own details. */
  async view(bookingId: string) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const booking = await this.loadBooking(tx, bookingId);
      const folio = await this.ensureFolio(tx, booking);
      const [org, assignments] = await Promise.all([
        tx.organization.findUnique({
          where: { id: organizationId },
          select: {
            name: true,
            kraPin: true,
            address: true,
            phone: true,
            email: true,
            invoiceFooter: true,
          },
        }),
        tx.hotelRoomAssignment.findMany({
          where: { bookingId },
          include: { room: { select: { number: true } } },
          orderBy: { fromAt: 'asc' },
        }),
      ]);
      const entries = [...folio.entries].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      return {
        booking: {
          id: booking.id,
          bookingNumber: booking.bookingNumber,
          status: booking.status,
          guestName: booking.guestName,
          guestPhone: booking.guestPhone,
          roomTypeName: booking.roomTypeName,
          checkIn: booking.checkIn.toISOString().slice(0, 10),
          checkOut: booking.checkOut.toISOString().slice(0, 10),
          nights: booking.nights,
          rooms: booking.rooms,
          pricePerNight: Number(booking.pricePerNight),
          roomNumbers: assignments
            .filter((a) => !a.toAt)
            .map((a) => a.room.number),
        },
        entries: entries.map(entryView),
        totals: this.summary(entries),
        business: org,
        printedOn: new Date(),
      };
    });
  }

  private requireOpen(booking: RoomBooking) {
    if (
      booking.status !== RoomBookingStatus.CONFIRMED &&
      booking.status !== RoomBookingStatus.CHECKED_IN
    ) {
      throw new ConflictException(
        `This booking is ${booking.status.toLowerCase().replace('_', ' ')}, so nothing can be added to its folio`,
      );
    }
  }

  /** Money taken from the guest: a deposit before arrival or a payment during or at the end of the stay. */
  async postPayment(bookingId: string, dto: PostPaymentDto) {
    const { orgUserId } = getTenantStore();
    if (dto.method === 'MPESA_RECEIPT' && !dto.reference)
      throw new BadRequestException('Enter the M-Pesa receipt code');
    return this.tenantPrisma.run(async (tx) => {
      const booking = await this.loadBooking(tx, bookingId);
      this.requireOpen(booking);
      if (dto.reference) {
        const used = await tx.hotelFolioEntry.findFirst({
          where: {
            method: dto.method,
            reference: dto.reference,
            type: { in: [FolioEntryType.PAYMENT] },
          },
        });
        if (used)
          throw new ConflictException('That receipt has already been recorded');
      }
      const folio = await this.ensureFolio(tx, booking);
      const entry = await tx.hotelFolioEntry.create({
        data: {
          folioId: folio.id,
          type: 'PAYMENT',
          amount: dto.amount,
          description: `Payment (${dto.method === 'MPESA_RECEIPT' ? 'M-Pesa' : dto.method.toLowerCase()})`,
          method: dto.method as PaymentMethod,
          reference: dto.reference || null,
          shiftId: dto.shiftId,
          createdById: orgUserId,
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.folio_payment',
        entityType: 'RoomBooking',
        entityId: bookingId,
        after: {
          amount: dto.amount,
          method: dto.method,
          reference: dto.reference ?? null,
        },
      });
      const all = [...folio.entries, entry];
      return { entry: entryView(entry), totals: this.summary(all) };
    });
  }

  /**
   * A correction by a manager. It can only take money OFF (a discount or fixing too high a figure): an extra amount is a charge
   * to the room from the POS with the item sold, so that it is a real sale. The reason is kept and audit-logged.
   */
  async postAdjustment(bookingId: string, dto: AdjustmentDto) {
    const { orgUserId } = getTenantStore();
    if (dto.amount >= 0)
      throw new BadRequestException(
        'An adjustment takes money off the bill (use a negative amount). To add something, charge it to the room from the till.',
      );
    return this.tenantPrisma.run(async (tx) => {
      const booking = await this.loadBooking(tx, bookingId);
      this.requireOpen(booking);
      const folio = await this.ensureFolio(tx, booking);
      const totals = this.summary(folio.entries);
      const room = totals.roomNights;
      const alreadyOff = -totals.adjustments;
      if (room > 0 && alreadyOff + -dto.amount > room + 0.001)
        throw new BadRequestException(
          'Adjustments cannot take off more than the room charges',
        );
      const entry = await tx.hotelFolioEntry.create({
        data: {
          folioId: folio.id,
          type: 'ADJUSTMENT',
          amount: dto.amount,
          description: `Adjustment: ${dto.reason}`,
          createdById: orgUserId,
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.folio_adjustment',
        entityType: 'RoomBooking',
        entityId: bookingId,
        after: { amount: dto.amount, reason: dto.reason },
      });
      return {
        entry: entryView(entry),
        totals: this.summary([...folio.entries, entry]),
      };
    });
  }

  /** Money handed back to the guest (e.g. a deposit on a cancelled booking). It cannot be more than they have paid. */
  async postRefund(bookingId: string, dto: RefundDto) {
    const { orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const booking = await this.loadBooking(tx, bookingId);
      const folio = await this.ensureFolio(tx, booking);
      const totals = this.summary(folio.entries);
      if (dto.amount > totals.payments - totals.refunds + 0.001)
        throw new BadRequestException(
          `The guest has only paid KES ${(totals.payments - totals.refunds).toFixed(2)} that can be refunded`,
        );
      const entry = await tx.hotelFolioEntry.create({
        data: {
          folioId: folio.id,
          type: 'REFUND',
          amount: dto.amount,
          description: `Refund: ${dto.reason}`,
          method: dto.method as PaymentMethod,
          reference: dto.reference || null,
          createdById: orgUserId,
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'hotel.folio_refund',
        entityType: 'RoomBooking',
        entityId: bookingId,
        after: { amount: dto.amount, method: dto.method, reason: dto.reason },
      });
      return {
        entry: entryView(entry),
        totals: this.summary([...folio.entries, entry]),
      };
    });
  }
}
