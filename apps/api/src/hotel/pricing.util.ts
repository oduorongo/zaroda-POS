// What a stay costs, as one plain function used by the marketplace quote, the marketplace booking and the front desk, so a guest is
// never quoted one price and charged another. All money is worked in whole cents.
//
// A night's room price, in order: a season covering that night (its weekend price on a weekend night, if it has one), else the
// weekend price on a weekend night, else the base price. Then, per night: extra adults and children beyond what a room includes,
// and the meal plan (per person per night). Tax is NOT in here - it is added on top of the result (see tax.util.ts).

export type MealPlanKey =
  'ROOM_ONLY' | 'BED_BREAKFAST' | 'HALF_BOARD' | 'FULL_BOARD';

export const MEAL_PLANS: { key: MealPlanKey; label: string }[] = [
  { key: 'ROOM_ONLY', label: 'Room only' },
  { key: 'BED_BREAKFAST', label: 'Bed & breakfast' },
  { key: 'HALF_BOARD', label: 'Half board' },
  { key: 'FULL_BOARD', label: 'Full board' },
];

export interface RateCard {
  /** The room type's price per night. */
  baseRate: number;
  /** Price on weekend nights; null = the base price. */
  weekendRate: number | null;
  /** 0 = Sunday ... 6 = Saturday: the nights counted as weekend nights (the night of that date). */
  weekendDays: number[];
  /** Adults included in one room's price. */
  includedAdults: number;
  /** Children per room who stay free. */
  freeChildren: number;
  extraAdultRate: number;
  extraChildRate: number;
}

export interface Season {
  name?: string;
  /** "2026-12-20", both ends included. */
  startDate: string;
  endDate: string;
  rate: number;
  weekendRate: number | null;
}

export type MealPrices = Partial<
  Record<MealPlanKey, { adult: number; child: number }>
>;

export interface PriceInput {
  /** "2026-11-05" - the first night. */
  checkIn: string;
  /** "2026-11-08" - the day they leave: not a night. */
  checkOut: string;
  rooms: number;
  adults: number;
  children: number;
  mealPlan: MealPlanKey;
  card: RateCard;
  seasons: Season[];
  meals: MealPrices;
}

export type RateSource = 'BASE' | 'WEEKEND' | 'SEASON' | 'SEASON_WEEKEND';

export interface NightPrice {
  date: string;
  /** The price of one room for this night. */
  rate: number;
  source: RateSource;
  seasonName: string | null;
  roomCharge: number;
  extraAdults: number;
  extraChildren: number;
  extraCharge: number;
  mealCharge: number;
  total: number;
}

export interface StayPrice {
  nights: NightPrice[];
  roomTotal: number;
  extraTotal: number;
  mealTotal: number;
  total: number;
  /** total / (rooms x nights) - what to show as "per night" when the price varies. */
  averageRate: number;
  /** Every night the same single room price and nothing extra: the stay is simply rate x rooms x nights. */
  uniform: boolean;
}

const DAY_MS = 86_400_000;
const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

const dayMs = (day: string) => new Date(`${day}T00:00:00Z`).getTime();

/** The nights of a stay as dates: check-in up to, not including, check-out. */
export function nightDates(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let t = dayMs(checkIn); t < dayMs(checkOut); t += DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** The season that covers a night: of several, the one that starts latest (the more specific one). */
export function seasonFor(date: string, seasons: Season[]): Season | null {
  const covering = seasons.filter(
    (s) => s.startDate <= date && date <= s.endDate,
  );
  if (covering.length === 0) return null;
  return covering.reduce((best, s) =>
    s.startDate >= best.startDate ? s : best,
  );
}

export function priceNight(date: string, input: PriceInput): NightPrice {
  const { card } = input;
  const weekend = card.weekendDays.includes(
    new Date(`${date}T00:00:00Z`).getUTCDay(),
  );
  const season = seasonFor(date, input.seasons);

  let rate = card.baseRate;
  let source: RateSource = 'BASE';
  if (season) {
    if (weekend && season.weekendRate !== null) {
      rate = season.weekendRate;
      source = 'SEASON_WEEKEND';
    } else {
      rate = season.rate;
      source = 'SEASON';
    }
  } else if (weekend && card.weekendRate !== null) {
    rate = card.weekendRate;
    source = 'WEEKEND';
  }

  const extraAdults = Math.max(
    0,
    input.adults - card.includedAdults * input.rooms,
  );
  const extraChildren = Math.max(
    0,
    input.children - card.freeChildren * input.rooms,
  );
  const meal =
    input.mealPlan === 'ROOM_ONLY' ? undefined : input.meals[input.mealPlan];

  const roomCharge = cents(rate) * input.rooms;
  const extraCharge =
    extraAdults * cents(card.extraAdultRate) +
    extraChildren * cents(card.extraChildRate);
  const mealCharge = meal
    ? input.adults * cents(meal.adult) + input.children * cents(meal.child)
    : 0;
  return {
    date,
    rate,
    source,
    seasonName: season?.name ?? null,
    roomCharge: money(roomCharge),
    extraAdults,
    extraChildren,
    extraCharge: money(extraCharge),
    mealCharge: money(mealCharge),
    total: money(roomCharge + extraCharge + mealCharge),
  };
}

/** Why a stay's occupancy is not acceptable, or null. */
export function occupancyProblem(
  input: { rooms: number; adults: number; children: number },
  maxGuestsPerRoom: number,
): string | null {
  if (!Number.isInteger(input.rooms) || input.rooms < 1)
    return 'Book at least one room';
  if (!Number.isInteger(input.adults) || input.adults < 1)
    return 'At least one adult is needed';
  if (!Number.isInteger(input.children) || input.children < 0)
    return 'The number of children cannot be negative';
  if (input.adults + input.children > maxGuestsPerRoom * input.rooms)
    return `A room sleeps up to ${maxGuestsPerRoom}. Choose more rooms or fewer guests.`;
  return null;
}

export function priceStay(input: PriceInput): StayPrice {
  const nights = nightDates(input.checkIn, input.checkOut).map((d) =>
    priceNight(d, input),
  );
  const sum = (pick: (n: NightPrice) => number) =>
    money(nights.reduce((s, n) => s + cents(pick(n)), 0));
  const total = sum((n) => n.total);
  const first = nights[0];
  return {
    nights,
    roomTotal: sum((n) => n.roomCharge),
    extraTotal: sum((n) => n.extraCharge),
    mealTotal: sum((n) => n.mealCharge),
    total,
    averageRate:
      nights.length > 0
        ? Math.round(cents(total) / (input.rooms * nights.length)) / 100
        : 0,
    uniform:
      nights.length > 0 &&
      nights.every(
        (n) =>
          n.rate === first.rate && n.extraCharge === 0 && n.mealCharge === 0,
      ),
  };
}
