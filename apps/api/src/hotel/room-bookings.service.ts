import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RoomBooking, RoomBookingStatus } from '@prisma/client';
import { decryptSecret, parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ShopCatalogService } from '../online-orders/shop-catalog.service';
import { generateCallbackToken, normalizeKenyanPhone, roundMoney, sha256 } from '../online-orders/online-orders.util';
import { DEFAULT_COMMISSION_RATE } from '../online-store/online-store.constants';
import { DarajaClient } from '../online-store/daraja.client';
import { darajaFailureMessage, evaluateDarajaCallback, parseDarajaCallback } from '../online-store/daraja.util';
import { darajaCredentials, gatewayOf, paymentsReady } from '../online-store/payment-gateway';
import { TumaClient } from '../online-store/tuma.client';
import { evaluateCallback, parseCallback } from '../online-store/tuma.util';
import { CreateBookingDto } from './dto/hotel.dto';
import {
  BOOKING_PAYMENT_WINDOW_MS,
  depositFor,
  nightsBetween,
  parseDay,
  stayProblem,
  stayTotal,
  todayInKenya,
} from './room-availability.util';
import { roomsLeft } from './room-stock';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
const RETRY_COOLDOWN_MS = 60_000;
// "I've paid, check now" costs the hotel KES 1 per press with Tuma, so it is rate limited.
const CHECK_COOLDOWN_MS = 30_000;
const MAX_CHECKS_PER_BOOKING = 5;
const NUMBER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const generateBookingNumber = () => `ZB-${Array.from({ length: 6 }, () => NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)]).join('')}`;

/** What a guest sees of their booking. Never anything payment-secret. */
export function toBookingView(b: RoomBooking) {
  const total = Number(b.total);
  const expired = b.status === RoomBookingStatus.PENDING_PAYMENT && b.paymentDeadline <= new Date();
  return {
    id: b.id,
    bookingNumber: b.bookingNumber,
    status: expired ? RoomBookingStatus.EXPIRED : b.status,
    hotel: { name: b.hotelName, slug: b.hotelSlug },
    roomTypeName: b.roomTypeName,
    checkIn: b.checkIn.toISOString().slice(0, 10),
    checkOut: b.checkOut.toISOString().slice(0, 10),
    nights: b.nights,
    rooms: b.rooms,
    guests: b.guests,
    guestName: b.guestName,
    guestPhone: b.guestPhone,
    notes: b.notes,
    total,
    depositAmount: b.depositAmount,
    balanceDue: roundMoney(total - b.depositAmount),
    paymentPhone: b.paymentPhone,
    paymentDeadline: b.paymentDeadline,
    mpesaReceiptNumber: b.mpesaReceiptNumber,
    paidAt: b.paidAt,
    lastPaymentError: b.lastPaymentError,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt,
  };
}

/**
 * A guest books a room and pays the deposit - no account. The deposit goes to the hotel's own shop payment account
 * (Tuma, or its own Paybill/Till), the same way a shop's online orders are paid, with the same trust rules: a payment is
 * learned from the gateway's free callback (secret HMAC address, amount and receipt checked), a callback that is not
 * complete only triggers one backup check, and one M-Pesa receipt can settle one booking.
 */
@Injectable()
export class RoomBookingsService {
  private readonly logger = new Logger(RoomBookingsService.name);
  private readonly checks = new Map<string, { last: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly catalog: ShopCatalogService,
    private readonly tuma: TumaClient,
    private readonly daraja: DarajaClient,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  private runAsTenant<T>(organizationId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  private encryptionKey(): Buffer {
    return parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
  }

  private callbackToken(bookingId: string): string {
    return createHmac('sha256', this.encryptionKey()).update(`room-booking-callback:${bookingId}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, bookingId: string, gateway: 'tuma' | 'daraja'): string {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/room-bookings/${organizationId}/${bookingId}/${gateway}-callback/${this.callbackToken(bookingId)}`;
  }

  private async notifySms(to: string | null | undefined, message: string) {
    const phone = to ? normalizeKenyanPhone(to) : null;
    if (!phone) return;
    await this.sms.sendSms({ to: `+${phone}`, message }).catch(() => undefined);
  }

  // ── The guest books ───────────────────────────────────────────────────

  async createBooking(slug: string, dto: CreateBookingDto) {
    const paymentPhone = normalizeKenyanPhone(dto.phone);
    if (!paymentPhone) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
    const checkIn = parseDay(dto.checkIn);
    const checkOut = parseDay(dto.checkOut);
    const problem = stayProblem(checkIn, checkOut, todayInKenya());
    if (problem || !checkIn || !checkOut) throw new BadRequestException(problem ?? 'Choose your dates');
    const nights = nightsBetween(checkIn, checkOut);

    const { token, hash } = generateCallbackToken();
    let created: RoomBooking | undefined;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await this.catalog.runForShop(slug, async (tx, shop) => {
          if (shop.hotelBlocked) throw new NotFoundException('That room is no longer on offer');
          const roomType = await tx.hotelRoomType.findFirst({ where: { id: dto.roomTypeId, isListed: true, isActive: true } });
          if (!roomType) throw new NotFoundException('That room is no longer on offer');
          if (dto.rooms > roomType.quantity) throw new BadRequestException(`This hotel has ${roomType.quantity} ${roomType.name} room${roomType.quantity === 1 ? '' : 's'}`);
          if (dto.guests > roomType.maxGuests * dto.rooms) {
            throw new BadRequestException(`A ${roomType.name} sleeps up to ${roomType.maxGuests}. Choose more rooms or fewer guests.`);
          }

          // Two guests must not take the last room between the availability check and the insert.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'room-type:' + roomType.id}))`;
          const left = await roomsLeft(tx, roomType, checkIn, checkOut);
          if (left < dto.rooms) {
            throw new ConflictException(left > 0 ? `Only ${left} ${roomType.name} room${left === 1 ? '' : 's'} left for those dates` : `Sorry, no ${roomType.name} rooms are free for those dates`);
          }

          const price = Number(roomType.pricePerNight);
          const total = stayTotal(price, nights, dto.rooms);
          return tx.roomBooking.create({
            data: {
              organizationId: shop.organizationId,
              roomTypeId: roomType.id,
              bookingNumber: generateBookingNumber(),
              guestName: dto.name,
              guestPhone: paymentPhone,
              guestEmail: dto.email || null,
              guests: dto.guests,
              rooms: dto.rooms,
              checkIn,
              checkOut,
              nights,
              notes: dto.notes || null,
              hotelName: shop.displayName,
              hotelSlug: shop.slug,
              roomTypeName: roomType.name,
              pricePerNight: price,
              total,
              depositAmount: depositFor(total, roomType.depositPercent),
              commissionRate: shop.commissionRate ?? DEFAULT_COMMISSION_RATE,
              paymentPhone,
              paymentDeadline: new Date(Date.now() + BOOKING_PAYMENT_WINDOW_MS),
              guestTokenHash: hash,
            },
          });
        });
      } catch (e) {
        const collided = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && JSON.stringify(e.meta?.target ?? '').includes('bookingNumber');
        if (!collided) throw e;
      }
    }
    if (!created) throw new ServiceUnavailableException('Could not create the booking - try again');

    const view = await this.startPayment(created);
    return { ...view, guestToken: `${created.organizationId}.${token}` };
  }

  /** Sends the deposit prompt. A failure to START the payment does not fail the booking: the guest can retry from their page. */
  private async startPayment(booking: RoomBooking) {
    const store = await this.runAsTenant(booking.organizationId, (tx) => tx.onlineStore.findUnique({ where: { organizationId: booking.organizationId } }));
    let requestId: string | null = null;
    let lastPaymentError: string | null = null;
    try {
      if (!store || !store.addonActive || !paymentsReady(store)) throw new ServiceUnavailableException('This hotel is not taking payments right now');
      if (gatewayOf(store) === 'DARAJA') {
        const creds = darajaCredentials(store, this.encryptionKey());
        if (!creds) throw new ServiceUnavailableException('This hotel is not taking payments right now');
        const result = await this.daraja.stkPush(creds, {
          amount: booking.depositAmount,
          phone: booking.paymentPhone,
          accountReference: booking.bookingNumber,
          description: 'Room deposit',
          callbackUrl: this.callbackUrl(booking.organizationId, booking.id, 'daraja'),
        });
        requestId = result.checkoutRequestId;
      } else {
        const result = await this.tuma.stkPush(
          { email: store.tumaEmail as string, apiKey: decryptSecret(store.tumaApiKeyEncrypted as string, this.encryptionKey()) },
          {
            amount: booking.depositAmount,
            phone: booking.paymentPhone,
            description: `${booking.hotelName} room deposit ${booking.bookingNumber}`,
            callbackUrl: this.callbackUrl(booking.organizationId, booking.id, 'tuma'),
          },
        );
        requestId = result.merchantRequestId;
      }
    } catch (e) {
      lastPaymentError = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, bookingId: booking.id }, 'Room deposit STK push failed');
    }
    const updated = await this.runAsTenant(booking.organizationId, (tx) =>
      tx.roomBooking.update({
        where: { id: booking.id },
        data: { paymentPhone: booking.paymentPhone, paymentAttemptedAt: new Date(), lastPaymentError, ...(requestId ? { tumaMerchantRequestId: requestId } : {}) },
      }),
    );
    return toBookingView(updated);
  }

  // ── The guest's own page ──────────────────────────────────────────────

  /** Finds a booking from the secret its guest holds, or says "not found" - never which part was wrong. */
  private async findGuestBooking(guestToken: string, bookingId: string): Promise<RoomBooking> {
    const [organizationId, secret] = guestToken.split('.');
    const valid = /^[0-9a-f-]{36}$/.test(organizationId ?? '') && !!secret;
    const booking = valid ? await this.runAsTenant(organizationId, (tx) => tx.roomBooking.findFirst({ where: { id: bookingId, organizationId } })) : null;
    const expected = booking ? Buffer.from(booking.guestTokenHash) : null;
    const actual = Buffer.from(sha256(secret ?? ''));
    if (!booking || !expected || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException('Booking not found');
    return booking;
  }

  async getForGuest(bookingId: string, guestToken: string) {
    return toBookingView(await this.findGuestBooking(guestToken, bookingId));
  }

  async retryForGuest(bookingId: string, guestToken: string, phoneInput?: string) {
    const booking = await this.findGuestBooking(guestToken, bookingId);
    if (booking.status !== RoomBookingStatus.PENDING_PAYMENT || booking.paymentDeadline <= new Date()) {
      throw new BadRequestException('This booking can no longer be paid - please book again');
    }
    if (booking.paymentAttemptedAt && Date.now() - booking.paymentAttemptedAt.getTime() < RETRY_COOLDOWN_MS && !booking.lastPaymentError) {
      throw new BadRequestException('Check your phone for the M-Pesa prompt - you can retry in a minute');
    }
    let paymentPhone = booking.paymentPhone;
    if (phoneInput) {
      const normalized = normalizeKenyanPhone(phoneInput);
      if (!normalized) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
      paymentPhone = normalized;
    }
    return this.startPayment({ ...booking, paymentPhone });
  }

  /** "I've paid, check now": the guest's backup when no callback arrived. Rate limited (each press can cost the hotel KES 1). */
  async checkForGuest(bookingId: string, guestToken: string) {
    const booking = await this.findGuestBooking(guestToken, bookingId);
    if (booking.status !== RoomBookingStatus.PENDING_PAYMENT || !booking.tumaMerchantRequestId) {
      return { ...toBookingView(booking), checkResult: 'not-needed' as const };
    }
    const state = this.checks.get(booking.id) ?? { last: 0, count: 0 };
    if (Date.now() - state.last < CHECK_COOLDOWN_MS) throw new BadRequestException('Please wait about 30 seconds before checking again');
    if (state.count >= MAX_CHECKS_PER_BOOKING) throw new BadRequestException('This booking has been checked several times already - please contact the hotel with your M-Pesa message');
    this.checks.set(booking.id, { last: Date.now(), count: state.count + 1 });

    const result = await this.verifyPayment(booking.organizationId, booking.id);
    const updated = (await this.findGuestBooking(guestToken, bookingId).catch(() => booking)) ?? booking;
    return {
      ...toBookingView(updated),
      checkResult: (result === 'paid' ? 'paid' : result === 'unconfirmed' ? 'not-paid-yet' : result === 'unavailable' ? 'unavailable' : 'not-needed') as 'paid' | 'not-paid-yet' | 'unavailable' | 'not-needed',
    };
  }

  // ── The gateways' callbacks ───────────────────────────────────────────

  private verifyToken(bookingId: string, token: string) {
    const expected = Buffer.from(this.callbackToken(bookingId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();
  }

  async handleTumaCallback(organizationId: string, bookingId: string, token: string, body: Record<string, unknown>) {
    this.verifyToken(bookingId, token);
    this.logger.log({ bookingId, fields: Object.keys(body ?? {}), status: (body as { status?: unknown })?.status }, 'Tuma room booking callback received');
    const booking = await this.runAsTenant(organizationId, (tx) => tx.roomBooking.findUnique({ where: { id: bookingId } }));
    if (!booking) throw new NotFoundException();
    if (booking.status !== RoomBookingStatus.PENDING_PAYMENT && booking.status !== RoomBookingStatus.EXPIRED) return { ok: true };

    const verdict = evaluateCallback(body, { amount: booking.depositAmount, latestRequestId: booking.tumaMerchantRequestId });
    const { merchantRequestId } = parseCallback(body);
    switch (verdict.kind) {
      case 'paid':
        await this.settle(organizationId, booking, verdict.receipt, merchantRequestId ?? booking.tumaMerchantRequestId ?? undefined);
        break;
      case 'review':
        this.logger.error({ bookingId, detail: verdict.detail }, 'A booking deposit does not match the payment - needs manual review');
        await this.flag(organizationId, bookingId, `A payment was received that doesn't match this booking (${verdict.detail}). Contact the hotel.`);
        break;
      case 'failed':
        if (booking.status === RoomBookingStatus.PENDING_PAYMENT && (!merchantRequestId || !booking.tumaMerchantRequestId || merchantRequestId === booking.tumaMerchantRequestId)) {
          await this.flag(organizationId, bookingId, 'The M-Pesa payment was cancelled or failed - try again');
        }
        break;
      case 'needs-check':
        this.logger.warn({ bookingId, reason: verdict.reason }, 'Callback was not complete enough to trust - asking Tuma (KES 1)');
        await this.verifyWithTuma(organizationId, bookingId).catch(() => undefined);
        break;
      case 'pending':
        break;
    }
    return { ok: true };
  }

  async handleDarajaCallback(organizationId: string, bookingId: string, token: string, body: Record<string, unknown>) {
    this.verifyToken(bookingId, token);
    const parsed = parseDarajaCallback(body);
    this.logger.log({ bookingId, resultCode: parsed.resultCode, hasReceipt: Boolean(parsed.receipt) }, 'Daraja room booking callback received');
    const booking = await this.runAsTenant(organizationId, (tx) => tx.roomBooking.findUnique({ where: { id: bookingId } }));
    if (!booking) throw new NotFoundException();
    const ack = { ResultCode: 0, ResultDesc: 'Accepted' };
    if (booking.status !== RoomBookingStatus.PENDING_PAYMENT && booking.status !== RoomBookingStatus.EXPIRED) return ack;

    const verdict = evaluateDarajaCallback(body, { amount: booking.depositAmount, latestRequestId: booking.tumaMerchantRequestId });
    switch (verdict.kind) {
      case 'paid':
        await this.settle(organizationId, booking, verdict.receipt, parsed.checkoutRequestId ?? booking.tumaMerchantRequestId ?? undefined);
        break;
      case 'review':
        this.logger.error({ bookingId, detail: verdict.detail }, 'A booking deposit does not match the payment - needs manual review');
        await this.flag(organizationId, bookingId, `A payment was received that doesn't match this booking (${verdict.detail}). Contact the hotel.`);
        break;
      case 'failed':
        if (booking.status === RoomBookingStatus.PENDING_PAYMENT && (!parsed.checkoutRequestId || !booking.tumaMerchantRequestId || parsed.checkoutRequestId === booking.tumaMerchantRequestId)) {
          await this.flag(organizationId, bookingId, darajaFailureMessage(parsed.resultCode, parsed.resultDesc));
        }
        break;
      case 'needs-check':
        await this.verifyWithDaraja(organizationId, bookingId).catch(() => undefined);
        break;
      case 'pending':
        break;
    }
    return ack;
  }

  private flag(organizationId: string, bookingId: string, message: string) {
    return this.runAsTenant(organizationId, (tx) => tx.roomBooking.update({ where: { id: bookingId }, data: { lastPaymentError: message } }));
  }

  private async verifyPayment(organizationId: string, bookingId: string) {
    const store = await this.runAsTenant(organizationId, (tx) => tx.onlineStore.findUnique({ where: { organizationId } }));
    return store && gatewayOf(store) === 'DARAJA' ? this.verifyWithDaraja(organizationId, bookingId) : this.verifyWithTuma(organizationId, bookingId);
  }

  private async verifyWithTuma(organizationId: string, bookingId: string): Promise<'paid' | 'review' | 'unconfirmed' | 'unavailable' | 'skipped'> {
    const { booking, store } = await this.runAsTenant(organizationId, async (tx) => ({
      booking: await tx.roomBooking.findUnique({ where: { id: bookingId } }),
      store: await tx.onlineStore.findUnique({ where: { organizationId } }),
    }));
    if (!booking || !store?.tumaEmail || !store.tumaApiKeyEncrypted || !booking.tumaMerchantRequestId) return 'skipped';
    if (booking.status !== RoomBookingStatus.PENDING_PAYMENT && booking.status !== RoomBookingStatus.EXPIRED) return 'skipped';

    const requestId = booking.tumaMerchantRequestId;
    const confirmation = await this.tuma.confirmPayment({ email: store.tumaEmail, apiKey: decryptSecret(store.tumaApiKeyEncrypted, this.encryptionKey()) }, requestId, booking.depositAmount);
    if (confirmation.outcome === 'review') {
      await this.flag(organizationId, bookingId, `A payment was received that doesn't match this booking (${confirmation.detail}). Contact the hotel.`);
      return 'review';
    }
    if (confirmation.outcome === 'unavailable') {
      await this.flag(organizationId, bookingId, 'We could not confirm the payment just now. If you have paid, the hotel can confirm it from its bookings page.');
      return 'unavailable';
    }
    if (confirmation.outcome !== 'paid') return 'unconfirmed';
    const outcome = await this.settle(organizationId, booking, confirmation.mpesaReceipt?.trim() || `TUMA:${requestId}`, requestId);
    return outcome === 'review' ? 'review' : 'paid';
  }

  private async verifyWithDaraja(organizationId: string, bookingId: string): Promise<'paid' | 'review' | 'unconfirmed' | 'unavailable' | 'skipped'> {
    const { booking, store } = await this.runAsTenant(organizationId, async (tx) => ({
      booking: await tx.roomBooking.findUnique({ where: { id: bookingId } }),
      store: await tx.onlineStore.findUnique({ where: { organizationId } }),
    }));
    const creds = store ? darajaCredentials(store, this.encryptionKey()) : null;
    if (!booking || !creds || !booking.tumaMerchantRequestId) return 'skipped';
    if (booking.status !== RoomBookingStatus.PENDING_PAYMENT && booking.status !== RoomBookingStatus.EXPIRED) return 'skipped';
    const requestId = booking.tumaMerchantRequestId;
    const result = await this.daraja.queryStk(creds, requestId);
    if (result.outcome === 'failed') {
      if (booking.status === RoomBookingStatus.PENDING_PAYMENT) await this.flag(organizationId, bookingId, darajaFailureMessage(result.resultCode, result.resultDesc));
      return 'unconfirmed';
    }
    if (result.outcome !== 'paid') return 'unconfirmed';
    const outcome = await this.settle(organizationId, booking, `DARAJA:${requestId}`, requestId);
    return outcome === 'review' ? 'review' : 'paid';
  }

  /**
   * Marks the deposit paid and the booking CONFIRMED. Conditional on still being unpaid, so a callback and a manual
   * confirmation racing each other confirm (and text the hotel) only once. A payment that lands after the window closed
   * is still honoured (the guest has paid); if the rooms were taken meanwhile, the booking is flagged and the hotel is texted.
   */
  private async settle(organizationId: string, booking: RoomBooking, receipt: string, requestId?: string): Promise<'paid' | 'skipped' | 'review'> {
    try {
      const settled = await this.runAsTenant(organizationId, async (tx) => {
        // The deposit came after the 15 minutes were up: the rooms were released and someone else may have taken them.
        // The guest HAS paid, so the booking is confirmed, but the hotel is told plainly to sort it out.
        let overbooked = false;
        if (booking.paymentDeadline.getTime() <= Date.now()) {
          const roomType = await tx.hotelRoomType.findUnique({ where: { id: booking.roomTypeId } });
          overbooked = !roomType || (await roomsLeft(tx, roomType, booking.checkIn, booking.checkOut)) < booking.rooms;
        }
        const result = await tx.roomBooking.updateMany({
          where: { id: booking.id, status: { in: [RoomBookingStatus.PENDING_PAYMENT, RoomBookingStatus.EXPIRED] } },
          data: {
            status: RoomBookingStatus.CONFIRMED,
            paidAt: new Date(),
            mpesaReceiptNumber: receipt,
            lastPaymentError: overbooked ? 'The deposit arrived after the rooms were released and they have been taken - the hotel will contact you or refund the deposit.' : null,
            ...(requestId ? { tumaMerchantRequestId: requestId } : {}),
          },
        });
        if (result.count !== 1) return null;
        const store = await tx.onlineStore.findUnique({ where: { organizationId }, select: { contactPhone: true } });
        return { contactPhone: store?.contactPhone, overbooked };
      });
      if (!settled) return 'skipped';
      const dates = `${booking.checkIn.toISOString().slice(0, 10)} to ${booking.checkOut.toISOString().slice(0, 10)}`;
      await this.notifySms(
        settled.contactPhone,
        settled.overbooked
          ? `ATTENTION booking ${booking.bookingNumber} (${booking.roomTypeName} x${booking.rooms}, ${dates}): the deposit KES ${booking.depositAmount} arrived late and the rooms are no longer free. Call the guest on ${booking.guestPhone} or refund them.`
          : `New booking ${booking.bookingNumber}: ${booking.roomTypeName} x${booking.rooms}, ${dates}. Deposit KES ${booking.depositAmount} paid (M-Pesa ${receipt}).`,
      );
      return 'paid';
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.logger.error({ bookingId: booking.id, receipt }, 'That M-Pesa receipt already settled a different booking');
        return 'review';
      }
      throw e;
    }
  }

  /** The hotel confirms a deposit by hand (it can see the M-Pesa message but the automatic confirmation never came). */
  async confirmPaymentByHotel(id: string, receipt: string) {
    const cleaned = receipt.trim().toUpperCase();
    try {
      const updated = await this.tenantPrisma.run(async (tx) => {
        const current = await tx.roomBooking.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Booking not found');
        const result = await tx.roomBooking.updateMany({
          where: { id, status: { in: [RoomBookingStatus.PENDING_PAYMENT, RoomBookingStatus.EXPIRED] } },
          data: { status: RoomBookingStatus.CONFIRMED, paidAt: new Date(), mpesaReceiptNumber: cleaned, lastPaymentError: null },
        });
        if (result.count !== 1) throw new BadRequestException('Only a booking that is waiting for its deposit can be marked as paid');
        return tx.roomBooking.findUniqueOrThrow({ where: { id } });
      });
      return toBookingView(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('That M-Pesa receipt is already attached to another booking');
      }
      throw e;
    }
  }
}
