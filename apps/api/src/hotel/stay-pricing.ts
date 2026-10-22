import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import {
  MealPlanKey,
  MealPrices,
  NightPrice,
  priceStay,
  PriceInput,
  RateCard,
  Season,
  StayPrice,
} from './pricing.util';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface RoomTypePricing {
  card: RateCard;
  seasons: Season[];
  meals: MealPrices;
}

/** A room type's price list: base price, weekend price, extras, seasons and meal prices. The same list prices every booking. */
export async function loadPricing(
  tx: TenantTx,
  roomType: { id: string; pricePerNight: unknown },
): Promise<RoomTypePricing> {
  const [card, seasons, meals] = await Promise.all([
    tx.hotelRateCard.findUnique({ where: { roomTypeId: roomType.id } }),
    tx.hotelSeason.findMany({ where: { roomTypeId: roomType.id } }),
    tx.hotelMealPrice.findMany({ where: { roomTypeId: roomType.id } }),
  ]);
  const mealPrices: MealPrices = {};
  for (const m of meals)
    mealPrices[m.plan] = {
      adult: Number(m.adultPrice),
      child: Number(m.childPrice),
    };
  return {
    card: {
      baseRate: Number(roomType.pricePerNight),
      weekendRate: card?.weekendRate != null ? Number(card.weekendRate) : null,
      weekendDays: card?.weekendDays ?? [5, 6],
      includedAdults: card?.includedAdults ?? 2,
      freeChildren: card?.freeChildren ?? 0,
      extraAdultRate: Number(card?.extraAdultRate ?? 0),
      extraChildRate: Number(card?.extraChildRate ?? 0),
    },
    seasons: seasons.map((s) => ({
      name: s.name,
      startDate: iso(s.startDate),
      endDate: iso(s.endDate),
      rate: Number(s.rate),
      weekendRate: s.weekendRate != null ? Number(s.weekendRate) : null,
    })),
    meals: mealPrices,
  };
}

export interface StayRequest {
  checkIn: string;
  checkOut: string;
  rooms: number;
  adults: number;
  children: number;
  mealPlan: MealPlanKey;
  /** A flat price per room per night chosen by a manager; seasons and the weekend price are then ignored. */
  rate?: number;
}

/** What a stay costs at today's price list. THE one place a stay is priced (marketplace quote, marketplace booking, front desk, changes). */
export async function quoteStay(
  tx: TenantTx,
  roomType: { id: string; pricePerNight: unknown },
  req: StayRequest,
): Promise<StayPrice> {
  return priceWith(await loadPricing(tx, roomType), req);
}

export function priceWith(
  pricing: RoomTypePricing,
  req: StayRequest,
): StayPrice {
  const input: PriceInput = {
    ...req,
    card:
      req.rate !== undefined
        ? { ...pricing.card, baseRate: req.rate, weekendRate: null }
        : pricing.card,
    seasons: req.rate !== undefined ? [] : pricing.seasons,
    meals: pricing.meals,
  };
  return priceStay(input);
}

/** What is kept on a booking about how it was priced, so a later change can keep the nights already agreed. */
export interface StoredBreakdown {
  nights: NightPrice[];
  roomTotal: number;
  extraTotal: number;
  mealTotal: number;
  flatRate: number | null;
}

export const breakdownOf = (
  price: StayPrice,
  flatRate: number | null,
): StoredBreakdown => ({
  nights: price.nights,
  roomTotal: price.roomTotal,
  extraTotal: price.extraTotal,
  mealTotal: price.mealTotal,
  flatRate,
});

export function readBreakdown(json: unknown): StoredBreakdown | null {
  const b = json as StoredBreakdown | null;
  return b && Array.isArray(b.nights) ? b : null;
}

/** True when every night is one plain room price with nothing extra: then the settlement sale is simply rate x nights x rooms. */
export const isUniform = (nights: NightPrice[]): boolean =>
  nights.length > 0 &&
  nights.every(
    (n) =>
      n.rate === nights[0].rate && n.extraCharge === 0 && n.mealCharge === 0,
  );

/** Each night's price (for all the booking's rooms), before tax - what the folio nights are made from. */
export function netPerNight(
  stored: StoredBreakdown | null,
  fallback: { rate: number; rooms: number; nights: number },
): number[] {
  if (stored) return stored.nights.map((n) => n.total);
  return Array.from(
    { length: fallback.nights },
    () => Math.round(fallback.rate * fallback.rooms * 100) / 100,
  );
}

/** How the settlement sale is shaped: quantity x unit price (net of tax). A uniform stay keeps the plain "rate x nights x rooms". */
export function settlementShape(
  booking: {
    pricePerNight: unknown;
    total: unknown;
    nights: number;
    rooms: number;
  },
  stored: StoredBreakdown | null,
): { quantity: number; rate: number } {
  if (!stored || isUniform(stored.nights))
    return {
      quantity: booking.nights * booking.rooms,
      rate: Number(booking.pricePerNight),
    };
  return { quantity: 1, rate: Number(booking.total) };
}

/** A stay's price put together again from its nights (some kept from the original agreement, some newly priced). */
export function restitch(nights: NightPrice[], rooms: number): StayPrice {
  const sum = (pick: (n: NightPrice) => number) =>
    nights.reduce((s, n) => s + Math.round(pick(n) * 100), 0) / 100;
  const total = sum((n) => n.total);
  return {
    nights,
    roomTotal: sum((n) => n.roomCharge),
    extraTotal: sum((n) => n.extraCharge),
    mealTotal: sum((n) => n.mealCharge),
    total,
    averageRate:
      nights.length > 0
        ? Math.round((total * 100) / (rooms * nights.length)) / 100
        : 0,
    uniform: isUniform(nights),
  };
}

/** The nights of a booking made before rate plans existed: its one price per night for every night. */
export function legacyNights(
  booking: { pricePerNight: unknown; rooms: number },
  dates: string[],
): NightPrice[] {
  const rate = Number(booking.pricePerNight);
  const room = Math.round(rate * booking.rooms * 100) / 100;
  return dates.map((date) => ({
    date,
    rate,
    source: 'BASE',
    seasonName: null,
    roomCharge: room,
    extraAdults: 0,
    extraChildren: 0,
    extraCharge: 0,
    mealCharge: 0,
    total: room,
  }));
}
