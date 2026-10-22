import { randomInt, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, RestaurantTableStatus, TableReservation, TableReservationStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { parseDay, todayInKenya } from '../hotel/room-availability.util';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ShopCatalogService } from '../online-orders/shop-catalog.service';
import { generateCallbackToken, normalizeKenyanPhone, sha256 } from '../online-orders/online-orders.util';
import { ConfirmReservationDto, CreateReservationDto, DeclineReservationDto } from './dto/reservation.dto';
import { MAX_OPEN_PER_PHONE, reservationProblem, timesClash } from './reservation.util';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
const LIST_CAP = 300;
const NUMBER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const generateNumber = () => `ZT-${Array.from({ length: 6 }, () => NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)]).join('')}`;
const prettyDay = (date: Date) => date.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

type WithTable = TableReservation & { table?: { label: string } | null };

/** What a guest (or the restaurant) sees of a reservation. Never anything secret. */
export function toReservationView(r: WithTable) {
  return {
    id: r.id,
    reservationNumber: r.reservationNumber,
    status: r.status,
    shop: { name: r.shopName, slug: r.shopSlug },
    guestName: r.guestName,
    guestPhone: r.guestPhone,
    partySize: r.partySize,
    date: r.date.toISOString().slice(0, 10),
    time: r.time,
    notes: r.notes,
    restaurantNote: r.restaurantNote,
    tableId: r.tableId,
    tableLabel: r.table?.label ?? null,
    createdAt: r.createdAt,
  };
}

/**
 * Table reservations. A guest asks for a table (date, time, party size) from the marketplace - no account, no payment -
 * and the restaurant confirms or declines it, optionally assigning a table; the guest is told by text. The restaurant
 * opts in (online_stores.reservationsEnabled) and is texted for each request. The guest's own page is opened with a secret
 * their browser holds (only its hash is stored), exactly like a table order or a room booking.
 */
@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly catalog: ShopCatalogService,
    private readonly sms: AfricasTalkingSmsProvider,
  ) {}

  private runAsTenant<T>(organizationId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /** Best effort - a text failing never fails the action. */
  private async notify(to: string | null | undefined, message: string) {
    const phone = to ? normalizeKenyanPhone(to) : null;
    if (!phone) return;
    await this.sms.sendSms({ to: `+${phone}`, message }).catch(() => undefined);
  }

  // ── The guest ─────────────────────────────────────────────────────────

  /** What the marketplace needs to decide whether to offer "Reserve a table". */
  async info(slug: string) {
    return this.catalog.runForShop(slug, async (_tx, shop) => ({ enabled: shop.reservationsEnabled, restaurant: shop.displayName }));
  }

  async create(slug: string, dto: CreateReservationDto) {
    const phone = normalizeKenyanPhone(dto.phone);
    if (!phone) throw new BadRequestException('Enter a phone number the restaurant can reach you on, e.g. 0712 345 678');
    const problem = reservationProblem({ date: dto.date, time: dto.time, partySize: dto.partySize });
    if (problem) throw new BadRequestException(problem);
    const date = parseDay(dto.date) as Date;

    const { token, hash } = generateCallbackToken();
    let created: TableReservation | undefined;
    let contactPhone: string | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await this.catalog.runForShop(slug, async (tx, shop) => {
          if (!shop.reservationsEnabled) throw new NotFoundException('This restaurant is not taking table requests online');
          const open = await tx.tableReservation.count({
            where: { guestPhone: phone, status: { in: [TableReservationStatus.REQUESTED, TableReservationStatus.CONFIRMED] }, date: { gte: todayInKenya() } },
          });
          if (open >= MAX_OPEN_PER_PHONE) {
            throw new ConflictException(`You already have ${MAX_OPEN_PER_PHONE} table requests open at this restaurant - please call them to change one`);
          }
          contactPhone = shop.contactPhone;
          return tx.tableReservation.create({
            data: {
              organizationId: shop.organizationId,
              branchId: shop.fulfilmentBranchId,
              reservationNumber: generateNumber(),
              guestName: dto.name,
              guestPhone: phone,
              partySize: dto.partySize,
              date,
              time: dto.time,
              notes: dto.notes || null,
              shopName: shop.displayName,
              shopSlug: shop.slug,
              guestTokenHash: hash,
            },
          });
        });
      } catch (e) {
        const collided = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && JSON.stringify(e.meta?.target ?? '').includes('reservationNumber');
        if (!collided) throw e;
      }
    }
    if (!created) throw new ConflictException('Could not record the request - please try again');

    await this.notify(
      contactPhone,
      `New table request ${created.reservationNumber}: ${created.partySize} ${created.partySize === 1 ? 'person' : 'people'}, ${prettyDay(created.date)} at ${created.time} (${created.guestName}, ${created.guestPhone}). Answer it under Tables & Kitchen > Reservations.`,
    );
    return { ...toReservationView(created), guestToken: `${created.organizationId}.${token}` };
  }

  /** Finds a reservation from the secret its guest holds, or says "not found" - never which part was wrong. */
  private async findGuestReservation(guestToken: string, id: string): Promise<WithTable> {
    const [organizationId, secret] = guestToken.split('.');
    const valid = /^[0-9a-f-]{36}$/.test(organizationId ?? '') && !!secret;
    const found = valid ? await this.runAsTenant(organizationId, (tx) => tx.tableReservation.findFirst({ where: { id, organizationId }, include: { table: { select: { label: true } } } })) : null;
    const expected = found ? Buffer.from(found.guestTokenHash) : null;
    const actual = Buffer.from(sha256(secret ?? ''));
    if (!found || !expected || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException('Reservation not found');
    return found;
  }

  async getForGuest(id: string, guestToken: string) {
    return toReservationView(await this.findGuestReservation(guestToken, id));
  }

  /** The guest cancels (any time before they are seated). The restaurant is told so it can free the table. */
  async cancelForGuest(id: string, guestToken: string) {
    const found = await this.findGuestReservation(guestToken, id);
    const { updated, contactPhone } = await this.runAsTenant(found.organizationId, async (tx) => {
      const result = await tx.tableReservation.updateMany({
        where: { id, status: { in: [TableReservationStatus.REQUESTED, TableReservationStatus.CONFIRMED] } },
        data: { status: TableReservationStatus.CANCELLED },
      });
      if (result.count === 0) throw new BadRequestException('This reservation can no longer be cancelled');
      const store = await tx.onlineStore.findFirst({ select: { contactPhone: true } });
      return { updated: await tx.tableReservation.findUniqueOrThrow({ where: { id }, include: { table: { select: { label: true } } } }), contactPhone: store?.contactPhone };
    });
    await this.notify(contactPhone, `Table request ${updated.reservationNumber} (${updated.guestName}, ${prettyDay(updated.date)} ${updated.time}) was cancelled by the guest.`);
    return toReservationView(updated);
  }

  // ── The restaurant ────────────────────────────────────────────────────

  async getSettings() {
    const store = await this.tenantPrisma.run((tx) => tx.onlineStore.findFirst({ select: { reservationsEnabled: true } }));
    return { enabled: store?.reservationsEnabled ?? false, hasShop: Boolean(store) };
  }

  async setSettings(enabled: boolean) {
    return this.tenantPrisma.run(async (tx) => {
      const store = await tx.onlineStore.findFirst();
      if (!store) throw new BadRequestException('Set up your online shop first (Settings > Online Shop) - reservations are taken through it');
      await tx.onlineStore.update({ where: { id: store.id }, data: { reservationsEnabled: enabled } });
      return { enabled };
    });
  }

  /** Upcoming reservations by default (today onwards), soonest first; or one date; or a status. */
  async list(filter: { date?: string; status?: TableReservationStatus; includePast?: boolean }) {
    const day = filter.date ? parseDay(filter.date) : null;
    const rows = await this.tenantPrisma.run((tx) =>
      tx.tableReservation.findMany({
        where: {
          ...(filter.status ? { status: filter.status } : {}),
          ...(day ? { date: day } : filter.includePast ? {} : { date: { gte: todayInKenya() } }),
        },
        include: { table: { select: { label: true } } },
        orderBy: [{ date: 'asc' }, { time: 'asc' }, { createdAt: 'asc' }],
        take: LIST_CAP,
      }),
    );
    return rows.map(toReservationView);
  }

  private async load(tx: TenantTx, id: string) {
    const reservation = await tx.tableReservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  private async finish(tx: TenantTx, id: string) {
    return tx.tableReservation.findUniqueOrThrow({ where: { id }, include: { table: { select: { label: true } } } });
  }

  /** Confirms a request, optionally with a table. Refused if that table is already promised to someone at about the same time. */
  async confirm(id: string, dto: ConfirmReservationDto) {
    const updated = await this.tenantPrisma.run(async (tx) => {
      const reservation = await this.load(tx, id);
      if (reservation.status !== TableReservationStatus.REQUESTED) throw new BadRequestException(`This request is already ${reservation.status.toLowerCase()}`);
      if (dto.tableId) {
        const table = await tx.restaurantTable.findUnique({ where: { id: dto.tableId } });
        if (!table || table.archivedAt) throw new NotFoundException('Table not found');
        if (table.seats < reservation.partySize) throw new BadRequestException(`${table.label} seats ${table.seats}, and this party is ${reservation.partySize}`);
        const others = await tx.tableReservation.findMany({
          where: { tableId: dto.tableId, date: reservation.date, id: { not: id }, status: { in: [TableReservationStatus.CONFIRMED, TableReservationStatus.SEATED] } },
        });
        const clash = others.find((o) => timesClash(o.time, reservation.time));
        if (clash) throw new ConflictException(`${table.label} is already booked for ${clash.guestName} at ${clash.time}`);
      }
      const result = await tx.tableReservation.updateMany({
        where: { id, status: TableReservationStatus.REQUESTED },
        data: { status: TableReservationStatus.CONFIRMED, tableId: dto.tableId ?? null, restaurantNote: dto.message || null, confirmedAt: new Date() },
      });
      if (result.count === 0) throw new ConflictException('Someone just answered this request - refresh');
      return this.finish(tx, id);
    });
    await this.notify(
      updated.guestPhone,
      `${updated.shopName}: your table is confirmed - ${updated.partySize} ${updated.partySize === 1 ? 'person' : 'people'}, ${prettyDay(updated.date)} at ${updated.time}. Ref ${updated.reservationNumber}.${dto.message ? ` ${dto.message}` : ''}`,
    );
    return toReservationView(updated);
  }

  async decline(id: string, dto: DeclineReservationDto) {
    const updated = await this.tenantPrisma.run(async (tx) => {
      const reservation = await this.load(tx, id);
      if (reservation.status !== TableReservationStatus.REQUESTED) throw new BadRequestException(`This request is already ${reservation.status.toLowerCase()}`);
      const result = await tx.tableReservation.updateMany({ where: { id, status: TableReservationStatus.REQUESTED }, data: { status: TableReservationStatus.DECLINED, restaurantNote: dto.reason } });
      if (result.count === 0) throw new ConflictException('Someone just answered this request - refresh');
      return this.finish(tx, id);
    });
    await this.notify(updated.guestPhone, `${updated.shopName}: sorry, we cannot take your table request ${updated.reservationNumber} for ${prettyDay(updated.date)} at ${updated.time}. ${dto.reason}`);
    return toReservationView(updated);
  }

  /** The party has arrived. If a table was assigned it goes to Occupied. */
  async seat(id: string) {
    const updated = await this.tenantPrisma.run(async (tx) => {
      const reservation = await this.load(tx, id);
      if (reservation.status !== TableReservationStatus.CONFIRMED) throw new BadRequestException('Only a confirmed reservation can be seated');
      const result = await tx.tableReservation.updateMany({ where: { id, status: TableReservationStatus.CONFIRMED }, data: { status: TableReservationStatus.SEATED } });
      if (result.count === 0) throw new ConflictException('This reservation was just updated - refresh');
      if (reservation.tableId) await tx.restaurantTable.update({ where: { id: reservation.tableId }, data: { status: RestaurantTableStatus.OCCUPIED } });
      return this.finish(tx, id);
    });
    return toReservationView(updated);
  }

  async noShow(id: string) {
    const updated = await this.tenantPrisma.run(async (tx) => {
      const reservation = await this.load(tx, id);
      if (reservation.status !== TableReservationStatus.CONFIRMED) throw new BadRequestException('Only a confirmed reservation can be marked as a no-show');
      await tx.tableReservation.updateMany({ where: { id, status: TableReservationStatus.CONFIRMED }, data: { status: TableReservationStatus.NO_SHOW } });
      return this.finish(tx, id);
    });
    return toReservationView(updated);
  }

  /** The restaurant cancels a confirmed reservation (the guest is told). */
  async cancel(id: string, reason: string) {
    const updated = await this.tenantPrisma.run(async (tx) => {
      const reservation = await this.load(tx, id);
      if (reservation.status !== TableReservationStatus.CONFIRMED && reservation.status !== TableReservationStatus.REQUESTED) throw new BadRequestException(`This reservation is already ${reservation.status.toLowerCase()}`);
      await tx.tableReservation.updateMany({ where: { id, status: reservation.status }, data: { status: TableReservationStatus.CANCELLED, restaurantNote: reason } });
      return this.finish(tx, id);
    });
    await this.notify(updated.guestPhone, `${updated.shopName}: we are sorry, your table for ${prettyDay(updated.date)} at ${updated.time} (ref ${updated.reservationNumber}) has been cancelled. ${reason}`);
    return toReservationView(updated);
  }
}
