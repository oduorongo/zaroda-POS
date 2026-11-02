import { randomBytes, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RentalStaySource, RentalStayStatus } from '@prisma/client';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../../common/crypto/secret-box';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../../common/tenant/tenant-context';
import { AfricasTalkingSmsProvider } from '../../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../../notifications/resend-email.provider';
import { normalizeKenyanPhone } from '../../online-orders/online-orders.util';
import { caretakerPropertyIds } from '../rental-caretaker-scope';
import { fromCents, nairobiToday, newReceiptNumber, toCents } from '../rental-billing.util';
import { assertFeature } from '../rental-plans.service';
import {
  CleaningDoneDto,
  CleaningDto,
  OwnerDto,
  StatementQueryDto,
  StayBlockDto,
  StayCalendarQueryDto,
  StayCancelDto,
  StayChangeDto,
  StayDto,
  StayFeedDto,
  StayListQueryDto,
  StayPaymentDto,
  StayUnitDto,
} from './stays.dto';
import {
  SOURCE_LABEL,
  StayMessageKind,
  addDays,
  buildIcal,
  calendarUrlProblem,
  daysBetween,
  overlaps,
  ownerLine,
  parseIcal,
  stayMessage,
  stayPrice,
  ymd,
} from './stays.util';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
const HOLDING: RentalStayStatus[] = ['CONFIRMED', 'CHECKED_IN'];
const EARNING: RentalStayStatus[] = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'];
const FEED_EVERY_MS = 55 * 60_000;
const SYNC_COOLDOWN_MS = 60_000;
const MAX_FEED_BYTES = 2_000_000;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const num = (v: Prisma.Decimal | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const d = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const nairobiHour = (now = new Date()) => (now.getUTCHours() + 3) % 24;

const stayInclude = { stayUnit: { select: { unit: { select: { label: true, propertyId: true, property: { select: { name: true } } } } } }, payments: true } as const;
type StayRow = Prisma.RentalStayGetPayload<{ include: typeof stayInclude }>;

/** What the guest still owes: the total less the channel's cut (it pays out the rest) less money in, plus refunds. */
function balanceOf(s: { total: Prisma.Decimal; channelFee: Prisma.Decimal; payments: { kind: string; amount: Prisma.Decimal; voidedAt: Date | null }[] }) {
  const paid = s.payments.filter((p) => !p.voidedAt).reduce((a, p) => a + (p.kind === 'REFUND' ? -1 : 1) * toCents(p.amount), 0);
  return { paidCents: paid, balanceCents: toCents(s.total) - toCents(s.channelFee) - paid };
}

function stayView(s: StayRow) {
  const { paidCents, balanceCents } = balanceOf(s);
  return {
    id: s.id,
    code: s.code,
    unitId: s.unitId,
    unit: s.stayUnit.unit.label,
    property: s.stayUnit.unit.property.name,
    source: s.source,
    sourceLabel: SOURCE_LABEL[s.source],
    externalRef: s.externalRef,
    guestName: s.guestName,
    guestPhone: s.guestPhone,
    guestEmail: s.guestEmail,
    guests: s.guests,
    checkIn: ymd(s.checkIn),
    checkOut: ymd(s.checkOut),
    nights: s.nights,
    accommodation: Number(s.accommodation),
    cleaningFee: Number(s.cleaningFee),
    channelFee: Number(s.channelFee),
    total: Number(s.total),
    paid: fromCents(paidCents),
    balance: fromCents(balanceCents),
    status: s.status,
    notes: s.notes,
    cancelReason: s.cancelReason,
    payments: s.payments
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((p) => ({ id: p.id, kind: p.kind, amount: Number(p.amount), method: p.method, reference: p.reference, paidAt: ymd(p.paidAt), receiptNumber: p.receiptNumber, note: p.note, voided: !!p.voidedAt, voidReason: p.voidReason })),
  };
}

/**
 * Short stays (ZARODA RENTALS): units let by the night, bookings direct or from Airbnb / Booking.com, calendars kept in step
 * by iCal both ways, payments with receipts, cleaning after each stay, owners' monthly statements and guest messages.
 * Caretakers see only the properties they are given, like everywhere else in rentals.
 */
@Injectable()
export class RentalStaysService {
  private readonly logger = new Logger(RentalStaysService.name);
  private readonly lastSync = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly config: ConfigService,
    private readonly email: ResendEmailProvider,
    private readonly sms: AfricasTalkingSmsProvider,
  ) {}

  private key(): Buffer {
    return parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
  }

  private runAsTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  private async scopeWhere(tx: Tx): Promise<Prisma.RentalStayUnitWhereInput> {
    const scope = await caretakerPropertyIds(tx);
    return scope ? { unit: { propertyId: { in: scope } } } : {};
  }

  private async stayUnitIn(tx: Tx, unitId: string) {
    const su = await tx.rentalStayUnit.findFirst({ where: { unitId, ...(await this.scopeWhere(tx)) }, include: { unit: { include: { property: true } } } });
    if (!su) throw new NotFoundException('That unit is not set up for short stays');
    return su;
  }

  private async stayIn(tx: Tx, id: string) {
    const s = await tx.rentalStay.findFirst({ where: { id, stayUnit: await this.scopeWhere(tx) }, include: stayInclude });
    if (!s) throw new NotFoundException('Booking not found');
    return s;
  }

  private exportUrl(organizationId: string, unitId: string, token: string, source?: string): string | null {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) return null;
    return `${base.replace(/\/+$/, '')}/public/rental-stays/${organizationId}/${unitId}/${token}.ics${source ? `?for=${source}` : ''}`;
  }

  // ── Units and owners ────────────────────────────────────────────────────

  async listUnits() {
    const { organizationId } = getTenantStore();
    const { units, stayUnits } = await this.tenantPrisma.run(async (tx) => {
      const scope = await caretakerPropertyIds(tx);
      return {
        units: await tx.rentalUnit.findMany({ where: scope ? { propertyId: { in: scope } } : {}, include: { property: { select: { name: true } } }, orderBy: [{ property: { name: 'asc' } }, { label: 'asc' }] }),
        stayUnits: await tx.rentalStayUnit.findMany({ include: { owner: { select: { name: true } }, feeds: { orderBy: { createdAt: 'asc' } } } }),
      };
    });
    const byUnit = new Map(stayUnits.map((s) => [s.unitId, s]));
    return units.map((u) => {
      const s = byUnit.get(u.id);
      return {
        unitId: u.id,
        label: u.label,
        property: u.property.name,
        propertyId: u.propertyId,
        unitStatus: u.status,
        shortStay: s
          ? {
              active: s.active,
              nightlyRate: Number(s.nightlyRate),
              weekendRate: num(s.weekendRate),
              minNights: s.minNights,
              maxGuests: s.maxGuests,
              cleaningFee: Number(s.cleaningFee),
              checkInTime: s.checkInTime,
              checkOutTime: s.checkOutTime,
              directions: s.directions,
              doorCode: s.doorCodeEncrypted ? decryptSecret(s.doorCodeEncrypted, this.key()) : null,
              cleanerName: s.cleanerName,
              cleanerPhone: s.cleanerPhone,
              ownerId: s.ownerId,
              owner: s.owner?.name ?? null,
              calendarUrl: this.exportUrl(organizationId, u.id, s.calendarToken),
              calendarUrls: {
                AIRBNB: this.exportUrl(organizationId, u.id, s.calendarToken, 'AIRBNB'),
                BOOKING_COM: this.exportUrl(organizationId, u.id, s.calendarToken, 'BOOKING_COM'),
              },
              feeds: s.feeds.map((f) => ({ id: f.id, source: f.source, url: f.url, lastSyncedAt: f.lastSyncedAt, lastError: f.lastError, eventCount: f.eventCount })),
            }
          : null,
      };
    });
  }

  async saveUnit(unitId: string, dto: StayUnitDto) {
    const { organizationId } = getTenantStore();
    if (dto.weekendRate === undefined) dto.weekendRate = null;
    return this.tenantPrisma.run(async (tx) => {
      const unit = await tx.rentalUnit.findUnique({ where: { id: unitId } });
      if (!unit) throw new NotFoundException('Unit not found');
      const active = dto.active ?? true;
      if (active) {
        await assertFeature(tx, organizationId, 'stays');
        if (unit.status === 'OCCUPIED') throw new ConflictException('This unit has a tenant on a lease. End the lease before letting it by the night.');
      }
      if (dto.ownerId && !(await tx.rentalUnitOwner.findUnique({ where: { id: dto.ownerId } }))) throw new NotFoundException('Owner not found');
      const data = {
        nightlyRate: dto.nightlyRate,
        weekendRate: dto.weekendRate ?? null,
        minNights: dto.minNights ?? 1,
        maxGuests: dto.maxGuests ?? 2,
        cleaningFee: dto.cleaningFee ?? 0,
        checkInTime: dto.checkInTime ?? '14:00',
        checkOutTime: dto.checkOutTime ?? '10:00',
        directions: dto.directions?.trim() || null,
        doorCodeEncrypted: dto.doorCode?.trim() ? encryptSecret(dto.doorCode.trim(), this.key()) : null,
        cleanerName: dto.cleanerName?.trim() || null,
        cleanerPhone: dto.cleanerPhone?.trim() || null,
        ownerId: dto.ownerId ?? null,
        active,
      };
      await tx.rentalStayUnit.upsert({ where: { unitId }, create: { organizationId, unitId, calendarToken: randomBytes(18).toString('base64url'), ...data }, update: data });
      // A unit let by the night must not also be advertised as a house to let.
      if (active) await tx.rentalListing.updateMany({ where: { unitId }, data: { isActive: false } });
      return { saved: true };
    });
  }

  async newCalendarLink(unitId: string) {
    await this.tenantPrisma.run(async (tx) => {
      await this.stayUnitIn(tx, unitId);
      await tx.rentalStayUnit.update({ where: { unitId }, data: { calendarToken: randomBytes(18).toString('base64url') } });
    });
    return { saved: true };
  }

  listOwners() {
    return this.tenantPrisma.run(async (tx) =>
      (await tx.rentalUnitOwner.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { stayUnits: true } } } })).map((o) => ({
        id: o.id,
        name: o.name,
        phone: o.phone,
        email: o.email,
        commissionPercent: Number(o.commissionPercent),
        notes: o.notes,
        units: o._count.stayUnits,
      })),
    );
  }

  async saveOwner(id: string | null, dto: OwnerDto) {
    const { organizationId } = getTenantStore();
    const data = { name: dto.name.trim(), phone: dto.phone?.trim() || null, email: dto.email?.trim().toLowerCase() || null, commissionPercent: dto.commissionPercent ?? 0, notes: dto.notes?.trim() || null };
    try {
      return await this.tenantPrisma.run(async (tx) => {
        if (!id) return tx.rentalUnitOwner.create({ data: { organizationId, ...data } });
        if (!(await tx.rentalUnitOwner.findUnique({ where: { id } }))) throw new NotFoundException('Owner not found');
        return tx.rentalUnitOwner.update({ where: { id }, data });
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException(`There is already an owner called ${data.name}`);
      throw e;
    }
  }

  async removeOwner(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.rentalUnitOwner.findUnique({ where: { id } }))) throw new NotFoundException('Owner not found');
      await tx.rentalUnitOwner.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // ── Bookings ────────────────────────────────────────────────────────────

  /** Why these dates cannot be booked, or null. A booking never clashes with its own channel's block for the same dates. */
  private async clash(tx: Tx, unitId: string, checkIn: string, checkOut: string, source: RentalStaySource, exceptStayId?: string): Promise<string | null> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'zaroda-stay:' + unitId}))`;
    const stays = await tx.rentalStay.findMany({ where: { unitId, status: { in: HOLDING }, checkIn: { lt: d(checkOut) }, checkOut: { gt: d(checkIn) }, ...(exceptStayId ? { id: { not: exceptStayId } } : {}) } });
    if (stays.length) return `Those dates clash with ${stays[0].code} (${stays[0].guestName}, ${ymd(stays[0].checkIn)} to ${ymd(stays[0].checkOut)})`;
    const blocks = await tx.rentalStayBlock.findMany({ where: { unitId, startDate: { lt: d(checkOut) }, endDate: { gt: d(checkIn) } } });
    const hit = blocks.find((b) => b.source === 'MANUAL' || b.source !== source);
    if (hit) return `Those dates are taken on ${SOURCE_LABEL[hit.source as keyof typeof SOURCE_LABEL] ?? hit.source} (${ymd(hit.startDate)} to ${ymd(hit.endDate)})`;
    return null;
  }

  private priced(su: { nightlyRate: Prisma.Decimal; weekendRate: Prisma.Decimal | null; cleaningFee: Prisma.Decimal }, checkIn: string, checkOut: string, accommodation?: number, cleaningFee?: number) {
    const p = stayPrice(checkIn, checkOut, toCents(su.nightlyRate), su.weekendRate === null ? null : toCents(su.weekendRate));
    const accCents = accommodation !== undefined ? toCents(accommodation) : p.accommodationCents;
    const cleanCents = cleaningFee !== undefined ? toCents(cleaningFee) : toCents(su.cleaningFee);
    return { nights: p.nights, accommodation: fromCents(accCents), cleaningFee: fromCents(cleanCents), total: fromCents(accCents + cleanCents) };
  }

  /** A price for the booking form, before it is saved. */
  async quote(unitId: string, checkIn: string, checkOut: string) {
    if (!(checkIn < checkOut)) throw new BadRequestException('Check-out must be after check-in');
    return this.tenantPrisma.run(async (tx) => {
      const su = await this.stayUnitIn(tx, unitId);
      return { ...this.priced(su, checkIn, checkOut), clash: await this.clash(tx, unitId, checkIn, checkOut, 'DIRECT') };
    });
  }

  async createStay(dto: StayDto) {
    const { organizationId } = getTenantStore();
    const checkIn = dto.checkIn.slice(0, 10);
    const checkOut = dto.checkOut.slice(0, 10);
    const source = dto.source ?? 'DIRECT';
    if (!(checkIn < checkOut)) throw new BadRequestException('Check-out must be after check-in');
    if (daysBetween(checkIn, checkOut) > 365) throw new BadRequestException('A short stay cannot be longer than a year. Use a lease instead.');
    if (checkIn < addDays(ymd(nairobiToday()), -60)) throw new BadRequestException('That check-in is more than 60 days ago');
    const stay = await this.tenantPrisma.run(async (tx) => {
      await assertFeature(tx, organizationId, 'stays');
      const su = await this.stayUnitIn(tx, dto.unitId);
      if (!su.active) throw new BadRequestException('Short stays are switched off for this unit');
      const p = this.priced(su, checkIn, checkOut, dto.accommodation, dto.cleaningFee);
      if (source === 'DIRECT') {
        if (p.nights < su.minNights) throw new BadRequestException(`This unit takes bookings of at least ${su.minNights} nights`);
        if ((dto.guests ?? 1) > su.maxGuests) throw new BadRequestException(`This unit sleeps at most ${su.maxGuests}`);
      }
      if (toCents(dto.channelFee ?? 0) > toCents(p.total)) throw new BadRequestException("The channel's fee cannot be more than the booking");
      const problem = await this.clash(tx, dto.unitId, checkIn, checkOut, source);
      if (problem) throw new ConflictException(problem);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'zaroda-stay-code:' + organizationId}))`;
      const code = `ST-${String((await tx.rentalStay.count()) + 1).padStart(4, '0')}`;
      const created = await tx.rentalStay.create({
        data: {
          organizationId,
          unitId: dto.unitId,
          code,
          source,
          externalRef: dto.externalRef?.trim() || null,
          guestName: dto.guestName.trim(),
          guestPhone: dto.guestPhone?.trim() || null,
          guestEmail: dto.guestEmail?.trim().toLowerCase() || null,
          guests: dto.guests ?? 1,
          checkIn: d(checkIn),
          checkOut: d(checkOut),
          nights: p.nights,
          accommodation: p.accommodation,
          cleaningFee: p.cleaningFee,
          channelFee: dto.channelFee ?? 0,
          total: p.total,
          notes: dto.notes?.trim() || null,
        },
      });
      await tx.rentalStayCleaning.create({ data: { organizationId, unitId: dto.unitId, stayId: created.id, dueDate: d(checkOut), cleanerName: su.cleanerName, cleanerPhone: su.cleanerPhone } });
      return tx.rentalStay.findUniqueOrThrow({ where: { id: created.id }, include: stayInclude });
    });
    const today = ymd(nairobiToday());
    if ((source === 'DIRECT' || source === 'OTHER') && checkIn >= today) {
      await this.send(organizationId, stay.id, 'CONFIRMATION');
      if (checkIn <= addDays(today, 1)) await this.send(organizationId, stay.id, 'ARRIVAL');
    }
    return stayView(stay);
  }

  async listStays(q: StayListQueryDto) {
    const today = nairobiToday();
    const where: Prisma.RentalStayWhereInput =
      q.view === 'current'
        ? { status: 'CHECKED_IN' }
        : q.view === 'past'
          ? { status: { in: ['CHECKED_OUT', 'NO_SHOW'] } }
          : q.view === 'cancelled'
            ? { status: 'CANCELLED' }
            : q.view === 'all'
              ? {}
              : { status: { in: HOLDING }, checkOut: { gte: today } };
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.rentalStay.findMany({
        where: { ...where, ...(q.unitId ? { unitId: q.unitId } : {}), stayUnit: await this.scopeWhere(tx) },
        include: stayInclude,
        orderBy: { checkIn: q.view === 'past' || q.view === 'cancelled' || q.view === 'all' ? 'desc' : 'asc' },
        take: 300,
      });
      return rows.map(stayView);
    });
  }

  async getStay(id: string) {
    return this.tenantPrisma.run(async (tx) => stayView(await this.stayIn(tx, id)));
  }

  async changeStay(id: string, dto: StayChangeDto) {
    return this.tenantPrisma.run(async (tx) => {
      const s = await this.stayIn(tx, id);
      if (!HOLDING.includes(s.status)) throw new BadRequestException('Only a booking that is still on can be changed');
      const checkIn = dto.checkIn?.slice(0, 10) ?? ymd(s.checkIn);
      const checkOut = dto.checkOut?.slice(0, 10) ?? ymd(s.checkOut);
      if (s.status === 'CHECKED_IN' && checkIn !== ymd(s.checkIn)) throw new BadRequestException('The guest is already in: only the check-out date can change');
      if (!(checkIn < checkOut)) throw new BadRequestException('Check-out must be after check-in');
      const datesMoved = checkIn !== ymd(s.checkIn) || checkOut !== ymd(s.checkOut);
      if (datesMoved) {
        const problem = await this.clash(tx, s.unitId, checkIn, checkOut, s.source, s.id);
        if (problem) throw new ConflictException(problem);
      }
      const su = await this.stayUnitIn(tx, s.unitId);
      const p = this.priced(su, checkIn, checkOut, dto.accommodation ?? (datesMoved ? undefined : Number(s.accommodation)), dto.cleaningFee ?? Number(s.cleaningFee));
      const channelFee = dto.channelFee ?? Number(s.channelFee);
      if (toCents(channelFee) > toCents(p.total)) throw new BadRequestException("The channel's fee cannot be more than the booking");
      await tx.rentalStay.update({
        where: { id },
        data: {
          guestName: dto.guestName?.trim() ?? undefined,
          guestPhone: dto.guestPhone === undefined ? undefined : dto.guestPhone?.trim() || null,
          guestEmail: dto.guestEmail === undefined ? undefined : dto.guestEmail?.trim().toLowerCase() || null,
          guests: dto.guests,
          externalRef: dto.externalRef === undefined ? undefined : dto.externalRef?.trim() || null,
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
          checkIn: d(checkIn),
          checkOut: d(checkOut),
          nights: p.nights,
          accommodation: p.accommodation,
          cleaningFee: p.cleaningFee,
          channelFee,
          total: p.total,
        },
      });
      if (datesMoved) await tx.rentalStayCleaning.updateMany({ where: { stayId: id, status: 'PENDING' }, data: { dueDate: d(checkOut) } });
      return stayView(await this.stayIn(tx, id));
    });
  }

  async checkIn(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const s = await this.stayIn(tx, id);
      if (s.status !== 'CONFIRMED') throw new BadRequestException('Only a confirmed booking can be checked in');
      if (ymd(nairobiToday()) < ymd(s.checkIn)) throw new BadRequestException(`This guest arrives on ${ymd(s.checkIn)}. Change the dates first to check in early.`);
      await tx.rentalStay.update({ where: { id }, data: { status: 'CHECKED_IN', checkedInAt: new Date() } });
      return stayView(await this.stayIn(tx, id));
    });
  }

  async checkOut(id: string) {
    const { organizationId } = getTenantStore();
    const view = await this.tenantPrisma.run(async (tx) => {
      const s = await this.stayIn(tx, id);
      if (s.status !== 'CHECKED_IN') throw new BadRequestException('Only a guest who is checked in can check out');
      const today = nairobiToday();
      await tx.rentalStay.update({ where: { id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date() } });
      // Leaving early: the cleaning is due today.
      if (today < s.checkOut) await tx.rentalStayCleaning.updateMany({ where: { stayId: id, status: 'PENDING' }, data: { dueDate: today } });
      return stayView(await this.stayIn(tx, id));
    });
    await this.send(organizationId, id, 'CLEANER');
    if (view.source === 'DIRECT' || view.source === 'OTHER') await this.send(organizationId, id, 'THANK_YOU');
    return view;
  }

  async cancel(id: string, dto: StayCancelDto, noShow = false) {
    return this.tenantPrisma.run(async (tx) => {
      const s = await this.stayIn(tx, id);
      if (s.status !== 'CONFIRMED') throw new BadRequestException(noShow ? 'Only a confirmed booking can be marked as a no-show' : 'Only a booking not yet checked in can be cancelled');
      if (noShow && ymd(nairobiToday()) < ymd(s.checkIn)) throw new BadRequestException('A guest can only be a no-show on or after the arrival day');
      await tx.rentalStay.update({ where: { id }, data: { status: noShow ? 'NO_SHOW' : 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason.trim() } });
      await tx.rentalStayCleaning.deleteMany({ where: { stayId: id, status: 'PENDING' } });
      return stayView(await this.stayIn(tx, id));
    });
  }

  // ── Payments ────────────────────────────────────────────────────────────

  async addPayment(stayId: string, dto: StayPaymentDto) {
    const { organizationId } = getTenantStore();
    const today = nairobiToday();
    const paidAt = dto.paidAt ? d(dto.paidAt) : today;
    if (paidAt > today) throw new BadRequestException('A payment cannot be dated in the future');
    const reference = dto.reference?.trim().toUpperCase() || null;
    const kind = dto.kind ?? 'PAYMENT';
    return this.tenantPrisma.run(async (tx) => {
      const s = await this.stayIn(tx, stayId);
      const { paidCents, balanceCents } = balanceOf(s);
      if (kind === 'REFUND' && toCents(dto.amount) > paidCents) throw new BadRequestException(`Only ${fromCents(paidCents)} has been paid, so no more than that can be refunded`);
      if (kind === 'PAYMENT' && toCents(dto.amount) > balanceCents) throw new BadRequestException(balanceCents > 0 ? `That is more than the balance of ${fromCents(balanceCents)}` : 'This booking is fully paid');
      if (reference && (await tx.rentalStayPayment.findFirst({ where: { reference }, select: { id: true } }))) throw new ConflictException(`The reference "${reference}" has already been recorded`);
      await tx.rentalStayPayment.create({
        data: { organizationId, stayId, kind, amount: dto.amount, method: dto.method, reference, paidAt, note: dto.note?.trim() || null, receiptNumber: newReceiptNumber(today).replace(/^RR-/, 'RS-') },
      });
      return stayView(await this.stayIn(tx, stayId));
    });
  }

  async voidPayment(stayId: string, paymentId: string, reason: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.stayIn(tx, stayId);
      const p = await tx.rentalStayPayment.findUnique({ where: { id: paymentId } });
      if (!p || p.stayId !== stayId) throw new NotFoundException('Payment not found');
      if (p.voidedAt) throw new BadRequestException('That payment is already voided');
      await tx.rentalStayPayment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidReason: reason.trim() } });
      return stayView(await this.stayIn(tx, stayId));
    });
  }

  // ── Calendar ────────────────────────────────────────────────────────────

  async calendar(q: StayCalendarQueryDto) {
    const from = q.from?.slice(0, 10) ?? ymd(nairobiToday());
    const to = addDays(from, q.days ?? 30);
    return this.tenantPrisma.run(async (tx) => {
      const units = await tx.rentalStayUnit.findMany({
        where: { active: true, ...(await this.scopeWhere(tx)) },
        include: {
          unit: { select: { label: true, property: { select: { name: true } } } },
          stays: { where: { status: { in: EARNING }, checkIn: { lt: d(to) }, checkOut: { gt: d(from) } }, include: { payments: true } },
          blocks: { where: { startDate: { lt: d(to) }, endDate: { gt: d(from) } } },
          cleanings: { where: { status: 'PENDING', dueDate: { lt: d(to) } } },
        },
        orderBy: [{ unit: { property: { name: 'asc' } } }, { unit: { label: 'asc' } }],
      });
      return {
        from,
        to,
        units: units.map((u) => {
          // An imported block that is just one of our own bookings on that channel is not shown twice.
          const blocks = u.blocks.filter((b) => !u.stays.some((s) => s.source === b.source && overlaps(ymd(s.checkIn), ymd(s.checkOut), ymd(b.startDate), ymd(b.endDate))));
          const clashes = blocks.filter((b) => u.stays.some((s) => HOLDING.includes(s.status) && overlaps(ymd(s.checkIn), ymd(s.checkOut), ymd(b.startDate), ymd(b.endDate))));
          return {
            unitId: u.unitId,
            label: u.unit.label,
            property: u.unit.property.name,
            stays: u.stays.map((s) => ({ id: s.id, code: s.code, guestName: s.guestName, source: s.source, status: s.status, checkIn: ymd(s.checkIn), checkOut: ymd(s.checkOut), balance: fromCents(balanceOf(s).balanceCents) })),
            blocks: blocks.map((b) => ({ id: b.id, source: b.source, startDate: ymd(b.startDate), endDate: ymd(b.endDate), summary: b.summary, manual: b.source === 'MANUAL', clash: clashes.includes(b) })),
            cleaningsDue: u.cleanings.map((c) => ymd(c.dueDate)),
          };
        }),
      };
    });
  }

  async addBlock(dto: StayBlockDto) {
    const { organizationId } = getTenantStore();
    const start = dto.startDate.slice(0, 10);
    const end = dto.endDate.slice(0, 10);
    if (!(start < end)) throw new BadRequestException('The last blocked day must be after the first');
    return this.tenantPrisma.run(async (tx) => {
      await this.stayUnitIn(tx, dto.unitId);
      const problem = await this.clash(tx, dto.unitId, start, end, 'DIRECT');
      if (problem && !problem.includes('taken on')) throw new ConflictException(problem);
      return tx.rentalStayBlock.create({ data: { organizationId, unitId: dto.unitId, source: 'MANUAL', startDate: d(start), endDate: d(end), summary: dto.summary?.trim() || 'Blocked' } });
    });
  }

  async removeBlock(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const b = await tx.rentalStayBlock.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Block not found');
      if (b.source !== 'MANUAL') throw new BadRequestException('Dates from Airbnb or Booking.com are freed there; the next calendar read removes them here');
      await this.stayUnitIn(tx, b.unitId);
      await tx.rentalStayBlock.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // ── Calendar feeds (iCal) ───────────────────────────────────────────────

  async addFeed(unitId: string, dto: StayFeedDto) {
    const { organizationId } = getTenantStore();
    const problem = calendarUrlProblem(dto.url);
    if (problem) throw new BadRequestException(problem);
    const url = dto.url.trim();
    let feedId: string;
    try {
      feedId = await this.tenantPrisma.run(async (tx) => {
        await assertFeature(tx, organizationId, 'stays');
        await this.stayUnitIn(tx, unitId);
        return (await tx.rentalStayFeed.create({ data: { organizationId, unitId, source: dto.source, url } })).id;
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('That calendar is already linked to this unit');
      throw e;
    }
    return this.syncFeed(organizationId, feedId);
  }

  async removeFeed(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const f = await tx.rentalStayFeed.findUnique({ where: { id } });
      if (!f) throw new NotFoundException('Calendar not found');
      await this.stayUnitIn(tx, f.unitId);
      await tx.rentalStayFeed.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async syncNow(id: string) {
    const { organizationId } = getTenantStore();
    const last = this.lastSync.get(id) ?? 0;
    if (Date.now() - last < SYNC_COOLDOWN_MS) throw new BadRequestException('That calendar was read less than a minute ago');
    await this.tenantPrisma.run(async (tx) => {
      const f = await tx.rentalStayFeed.findUnique({ where: { id } });
      if (!f) throw new NotFoundException('Calendar not found');
      await this.stayUnitIn(tx, f.unitId);
    });
    return this.syncFeed(organizationId, id);
  }

  /** Fetches a booking site's calendar (only allowed hosts, redirects checked, size and time limited). */
  private async fetchCalendar(raw: string): Promise<string> {
    let url = raw;
    for (let hop = 0; hop < 4; hop++) {
      const problem = calendarUrlProblem(url);
      if (problem) throw new Error(problem);
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'ZARODA-RENTALS-calendar/1.0', Accept: 'text/calendar, */*' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url).toString();
        continue;
      }
      if (!res.ok) throw new Error(`The booking site answered ${res.status}. Check the calendar link.`);
      const text = await res.text();
      if (text.length > MAX_FEED_BYTES) throw new Error('That calendar is too large');
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link is not a calendar (.ics) file');
      return text;
    }
    throw new Error('The calendar link redirects too many times');
  }

  async syncFeed(organizationId: string, feedId: string) {
    this.lastSync.set(feedId, Date.now());
    const feed = await this.runAsTenant(organizationId, (tx) => tx.rentalStayFeed.findUnique({ where: { id: feedId } }));
    if (!feed) throw new NotFoundException('Calendar not found');
    let text: string;
    try {
      text = await this.fetchCalendar(feed.url);
    } catch (e) {
      const message = e instanceof Error && e.name !== 'TimeoutError' ? e.message.slice(0, 300) : 'The booking site did not answer in time';
      await this.runAsTenant(organizationId, (tx) => tx.rentalStayFeed.update({ where: { id: feedId }, data: { lastError: message, lastSyncedAt: new Date() } }));
      return { synced: false, error: message, events: feed.eventCount };
    }
    const events = parseIcal(text, ymd(nairobiToday()));
    await this.runAsTenant(organizationId, async (tx) => {
      const uids = events.map((e) => e.uid);
      await tx.rentalStayBlock.deleteMany({ where: { feedId, uid: { notIn: uids } } });
      for (const e of events) {
        const data = { startDate: d(e.start), endDate: d(e.end), summary: e.summary };
        await tx.rentalStayBlock.upsert({ where: { feedId_uid: { feedId, uid: e.uid } }, create: { organizationId, unitId: feed.unitId, feedId, source: feed.source, uid: e.uid, ...data }, update: data });
      }
      await tx.rentalStayFeed.update({ where: { id: feedId }, data: { lastSyncedAt: new Date(), lastError: null, eventCount: events.length } });
    });
    return { synced: true, error: null, events: events.length };
  }

  /** The unit's busy dates for Airbnb / Booking.com to read. ?for=AIRBNB leaves out what came from Airbnb itself. */
  async exportCalendar(organizationId: string, unitId: string, token: string, forSource?: string): Promise<string> {
    return this.runAsTenant(organizationId, async (tx) => {
      const su = await tx.rentalStayUnit.findUnique({ where: { unitId }, include: { unit: { select: { label: true } } } });
      const a = Buffer.from(su?.calendarToken ?? '');
      const b = Buffer.from(token);
      if (!su || a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException('Calendar not found');
      const today = nairobiToday();
      const exclude = (s: string) => forSource !== undefined && s === forSource;
      const stays = await tx.rentalStay.findMany({ where: { unitId, status: { in: HOLDING }, checkOut: { gt: today } } });
      const blocks = await tx.rentalStayBlock.findMany({ where: { unitId, endDate: { gt: today } } });
      return buildIcal(su.unit.label, [
        ...stays.filter((s) => !exclude(s.source)).map((s) => ({ uid: `${s.id}@zaroda-rentals`, start: ymd(s.checkIn), end: ymd(s.checkOut), summary: 'Booked' })),
        ...blocks.filter((x) => !exclude(x.source)).map((x) => ({ uid: `${x.id}@zaroda-rentals`, start: ymd(x.startDate), end: ymd(x.endDate), summary: 'Not available' })),
      ]);
    });
  }

  // ── Cleaning ────────────────────────────────────────────────────────────

  async listCleanings(view?: string) {
    const today = nairobiToday();
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.rentalStayCleaning.findMany({
        where: { stayUnit: await this.scopeWhere(tx), ...(view === 'done' ? { status: 'DONE' } : { status: 'PENDING', dueDate: { lte: new Date(today.getTime() + 7 * 86_400_000) } }) },
        include: { stayUnit: { select: { unit: { select: { label: true, property: { select: { name: true } } } } } }, stay: { select: { code: true, guestName: true, status: true } } },
        orderBy: { dueDate: view === 'done' ? 'desc' : 'asc' },
        take: 200,
      });
      const nextArrivals = await tx.rentalStay.findMany({ where: { unitId: { in: rows.map((r) => r.unitId) }, status: 'CONFIRMED', checkIn: { gte: today } }, orderBy: { checkIn: 'asc' }, select: { unitId: true, checkIn: true } });
      return rows.map((c) => ({
        id: c.id,
        unitId: c.unitId,
        unit: c.stayUnit.unit.label,
        property: c.stayUnit.unit.property.name,
        dueDate: ymd(c.dueDate),
        overdue: c.status === 'PENDING' && c.dueDate < today,
        status: c.status,
        stay: c.stay ? { code: c.stay.code, guestName: c.stay.guestName, guestLeft: c.stay.status === 'CHECKED_OUT' } : null,
        nextArrival: nextArrivals.find((a) => a.unitId === c.unitId && a.checkIn >= c.dueDate)?.checkIn.toISOString().slice(0, 10) ?? null,
        cleanerName: c.cleanerName,
        cleanerPhone: c.cleanerPhone,
        notes: c.notes,
        doneAt: c.doneAt,
      }));
    });
  }

  async addCleaning(dto: CleaningDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const su = await this.stayUnitIn(tx, dto.unitId);
      return tx.rentalStayCleaning.create({
        data: { organizationId, unitId: dto.unitId, dueDate: d(dto.dueDate), cleanerName: dto.cleanerName?.trim() || su.cleanerName, cleanerPhone: dto.cleanerPhone?.trim() || su.cleanerPhone, notes: dto.notes?.trim() || null },
      });
    });
  }

  async cleaningDone(id: string, dto: CleaningDoneDto) {
    const { orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const c = await tx.rentalStayCleaning.findFirst({ where: { id, stayUnit: await this.scopeWhere(tx) } });
      if (!c) throw new NotFoundException('Cleaning not found');
      if (c.status === 'DONE') throw new BadRequestException('That cleaning is already marked done');
      return tx.rentalStayCleaning.update({ where: { id }, data: { status: 'DONE', doneAt: new Date(), doneById: orgUserId, notes: dto.notes?.trim() || c.notes } });
    });
  }

  // ── Owners' statements ──────────────────────────────────────────────────

  async statement(q: StatementQueryDto) {
    const first = `${q.month}-01`;
    const [y, m] = q.month.split('-').map(Number);
    const next = ymd(new Date(Date.UTC(y, m, 1)));
    const data = await this.tenantPrisma.run(async (tx) => {
      const units = await tx.rentalStayUnit.findMany({
        where: q.ownerId === 'own' ? { ownerId: null } : q.ownerId ? { ownerId: q.ownerId } : {},
        include: {
          owner: true,
          unit: { select: { label: true, property: { select: { name: true } } } },
          stays: { where: { status: { in: EARNING }, checkIn: { lt: d(next) }, checkOut: { gt: d(first) } } },
        },
        orderBy: [{ unit: { property: { name: 'asc' } } }, { unit: { label: 'asc' } }],
      });
      const expenses = await tx.rentalExpense.groupBy({ by: ['unitId'], where: { unitId: { in: units.map((u) => u.unitId) }, incurredAt: { gte: d(first), lt: d(next) } }, _sum: { amount: true } });
      return { units, expenses: new Map(expenses.map((e) => [e.unitId, toCents(e._sum.amount ?? 0)])) };
    });
    type Line = ReturnType<typeof ownerLine> & { unit: string; property: string; stays: number };
    const groups = new Map<string, { ownerId: string | null; owner: string; email: string | null; commissionPercent: number; lines: Line[] }>();
    for (const u of data.units) {
      const key = u.ownerId ?? 'own';
      if (!groups.has(key)) groups.set(key, { ownerId: u.ownerId, owner: u.owner?.name ?? 'Own units', email: u.owner?.email ?? null, commissionPercent: u.owner ? Number(u.owner.commissionPercent) : 0, lines: [] });
      const g = groups.get(key)!;
      const line = ownerLine(
        u.stays.map((s) => ({ checkIn: ymd(s.checkIn), checkOut: ymd(s.checkOut), accommodationCents: toCents(s.accommodation), cleaningCents: toCents(s.cleaningFee), channelCents: toCents(s.channelFee) })),
        data.expenses.get(u.unitId) ?? 0,
        g.commissionPercent,
        first,
        next,
      );
      g.lines.push({ unit: u.unit.label, property: u.unit.property.name, stays: u.stays.length, ...line });
    }
    const owners = [...groups.values()].map((g) => {
      const lines = g.lines.map((l) => ({
        unit: l.unit,
        property: l.property,
        stays: l.stays,
        nights: l.nights,
        occupancyPercent: l.occupancyPercent,
        accommodation: fromCents(l.accommodationCents),
        cleaning: fromCents(l.cleaningCents),
        channelFees: fromCents(l.channelCents),
        net: fromCents(l.netCents),
        commission: fromCents(l.commissionCents),
        expenses: fromCents(l.expensesCents),
        payable: fromCents(l.payableCents),
      }));
      const sum = (k: keyof (typeof lines)[number]) => fromCents(lines.reduce((a, l) => a + toCents(l[k]), 0));
      return {
        ownerId: g.ownerId,
        owner: g.owner,
        email: g.email,
        commissionPercent: g.commissionPercent,
        lines,
        totals: { nights: lines.reduce((a, l) => a + l.nights, 0), accommodation: sum('accommodation'), cleaning: sum('cleaning'), channelFees: sum('channelFees'), net: sum('net'), commission: sum('commission'), expenses: sum('expenses'), payable: sum('payable') },
      };
    });
    return { month: q.month, owners };
  }

  statementCsv(s: Awaited<ReturnType<RentalStaysService['statement']>>): string {
    const cell = (v: string | number) => {
      const t = String(v);
      const safe = /^[=+\-@\t\r]/.test(t) && typeof v === 'string' ? `'${t}` : t;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const rows = [['Owner', 'Property', 'Unit', 'Stays', 'Nights', 'Occupancy %', 'Accommodation', 'Cleaning', 'Channel fees', 'Net', 'Commission', 'Expenses', 'Payable to owner']];
    for (const o of s.owners) {
      for (const l of o.lines) rows.push([o.owner, l.property, l.unit, String(l.stays), String(l.nights), String(l.occupancyPercent), String(l.accommodation), String(l.cleaning), String(l.channelFees), String(l.net), String(l.commission), String(l.expenses), String(l.payable)]);
      const t = o.totals;
      rows.push([`${o.owner} total`, '', '', '', String(t.nights), '', String(t.accommodation), String(t.cleaning), String(t.channelFees), String(t.net), String(t.commission), String(t.expenses), String(t.payable)]);
    }
    return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // ── Settings and messages ───────────────────────────────────────────────

  private smsConfigured(): boolean {
    return Boolean(this.config.get<string>('AFRICAS_TALKING_API_KEY') && this.config.get<string>('AFRICAS_TALKING_USERNAME'));
  }

  async getSettings() {
    const { organizationId } = getTenantStore();
    const s = await this.tenantPrisma.run((tx) => tx.rentalSettings.findUnique({ where: { organizationId }, select: { stayTexts: true } }));
    return { stayTexts: s?.stayTexts ?? false, smsAvailable: this.smsConfigured(), calendarLinksAvailable: !!this.config.get<string>('PUBLIC_API_BASE_URL') };
  }

  async setSettings(stayTexts: boolean) {
    const { organizationId } = getTenantStore();
    await this.tenantPrisma.run((tx) => tx.rentalSettings.upsert({ where: { organizationId }, create: { organizationId, stayTexts }, update: { stayTexts } }));
    return this.getSettings();
  }

  /**
   * Sends one message for a stay, at most once per kind: the row is claimed first, and released if nothing could be sent.
   * Guests get a text when texts are on (else, or if the text fails, an email); the cleaner gets a text.
   */
  async send(organizationId: string, stayId: string, kind: StayMessageKind): Promise<'sent' | 'skipped'> {
    try {
      const facts = await this.runAsTenant(organizationId, async (tx) => {
        const s = await tx.rentalStay.findUnique({ where: { id: stayId }, include: { payments: true, stayUnit: { include: { unit: { select: { label: true } } } } } });
        if (!s) return null;
        const settings = await tx.rentalSettings.findUnique({ where: { organizationId }, select: { stayTexts: true } });
        const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
        try {
          await tx.rentalStayNotification.create({ data: { organizationId, stayId, kind, channel: 'PENDING' } });
        } catch (e) {
          if (isUnique(e)) return null;
          throw e;
        }
        const next = kind === 'CLEANER' ? await tx.rentalStay.findFirst({ where: { unitId: s.unitId, status: 'CONFIRMED', checkIn: { gte: s.checkIn } }, orderBy: { checkIn: 'asc' }, select: { checkIn: true } }) : null;
        const su = s.stayUnit;
        return {
          texts: !!settings?.stayTexts,
          phone: normalizeKenyanPhone((kind === 'CLEANER' ? su.cleanerPhone : s.guestPhone) ?? ''),
          email: kind === 'CLEANER' ? null : s.guestEmail,
          message: stayMessage(kind, {
            business: org?.name ?? 'Your host',
            guestName: s.guestName,
            unit: su.unit.label,
            code: s.code,
            checkIn: ymd(s.checkIn),
            checkOut: ymd(s.checkOut),
            checkInTime: su.checkInTime,
            checkOutTime: su.checkOutTime,
            balanceCents: balanceOf(s).balanceCents,
            directions: su.directions,
            doorCode: su.doorCodeEncrypted ? decryptSecret(su.doorCodeEncrypted, this.key()) : null,
            nextArrival: next ? ymd(next.checkIn) : null,
          }),
          business: org?.name ?? 'Your host',
        };
      });
      if (!facts) return 'skipped';
      let channel: 'SMS' | 'EMAIL' | null = null;
      if (facts.texts && facts.phone && this.smsConfigured() && (await this.sms.sendSms({ to: `+${facts.phone}`, message: facts.message })).sent) channel = 'SMS';
      if (!channel && facts.email) {
        const html = `<p>${facts.message.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p style="color:#888;font-size:12px">Sent by ${facts.business} with ZARODA RENTALS</p>`;
        if ((await this.email.sendEmail({ to: facts.email, subject: `${facts.business}: your stay`, html, text: facts.message })).sent) channel = 'EMAIL';
      }
      await this.runAsTenant(organizationId, (tx) =>
        channel ? tx.rentalStayNotification.update({ where: { stayId_kind: { stayId, kind } }, data: { channel } }) : tx.rentalStayNotification.delete({ where: { stayId_kind: { stayId, kind } } }),
      );
      return channel ? 'sent' : 'skipped';
    } catch (e) {
      this.logger.warn({ err: e, stayId, kind }, 'Short-stay message failed');
      return 'skipped';
    }
  }

  /** The hourly pass for one landlord: read linked calendars, and send arrival messages (10:00 to 20:00 Nairobi time). */
  async runForOrganization(organizationId: string, now: Date = new Date()) {
    const { feeds, arrivals } = await this.runAsTenant(organizationId, async (tx) => {
      const today = nairobiToday(now);
      return {
        feeds: await tx.rentalStayFeed.findMany({ where: { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - FEED_EVERY_MS) } }] }, select: { id: true } }),
        arrivals: await tx.rentalStay.findMany({
          where: { status: 'CONFIRMED', source: { in: ['DIRECT', 'OTHER'] }, checkIn: { gte: today, lte: new Date(today.getTime() + 86_400_000) }, notifications: { none: { kind: 'ARRIVAL' } } },
          select: { id: true },
        }),
      };
    });
    for (const f of feeds) await this.syncFeed(organizationId, f.id).catch((e) => this.logger.warn({ err: e, feedId: f.id }, 'Calendar read failed'));
    const hour = nairobiHour(now);
    if (hour >= 10 && hour < 20) for (const s of arrivals) await this.send(organizationId, s.id, 'ARRIVAL');
    return { feeds: feeds.length, arrivals: hour >= 10 && hour < 20 ? arrivals.length : 0 };
  }
}
