import { priceStay } from './pricing.util';
import {
  breakdownOf,
  isUniform,
  legacyNights,
  netPerNight,
  priceWith,
  readBreakdown,
  restitch,
  settlementShape,
} from './stay-pricing';

const pricing = {
  card: {
    baseRate: 5000,
    weekendRate: 6500,
    weekendDays: [5, 6],
    includedAdults: 2,
    freeChildren: 0,
    extraAdultRate: 1500,
    extraChildRate: 800,
  },
  seasons: [
    {
      name: 'Festive',
      startDate: '2026-12-20',
      endDate: '2027-01-05',
      rate: 9000,
      weekendRate: null,
    },
  ],
  meals: { BED_BREAKFAST: { adult: 800, child: 400 } },
};
const req = {
  checkIn: '2026-10-26',
  checkOut: '2026-10-29',
  rooms: 1,
  adults: 2,
  children: 0,
  mealPlan: 'ROOM_ONLY' as const,
};

describe('priceWith', () => {
  it('prices from the price list', () => {
    expect(priceWith(pricing, req).total).toBe(15000);
  });
  it("a manager's flat rate replaces the room price: no season, no weekend price, but extras and meals still apply", () => {
    const festive = { ...req, checkIn: '2026-12-23', checkOut: '2026-12-26' }; // season nights, one weekend night
    const normal = priceWith(pricing, festive);
    const flat = priceWith(pricing, { ...festive, rate: 4000 });
    expect(normal.nights.every((n) => n.source !== 'BASE')).toBe(true);
    expect(flat.nights.map((n) => [n.rate, n.source])).toEqual([
      [4000, 'BASE'],
      [4000, 'BASE'],
      [4000, 'BASE'],
    ]);
    expect(flat.total).toBe(12000);
    expect(
      priceWith(pricing, { ...festive, rate: 4000, adults: 3 }).total,
    ).toBe(12000 + 3 * 1500);
    expect(
      priceWith(pricing, { ...festive, rate: 4000, mealPlan: 'BED_BREAKFAST' })
        .mealTotal,
    ).toBe(3 * 1600);
  });
});

describe('isUniform / settlementShape', () => {
  const booking = (p: ReturnType<typeof priceWith>, rooms = 1) => ({
    pricePerNight: p.averageRate,
    total: p.total,
    nights: p.nights.length,
    rooms,
  });
  it('a plain stay is rate x nights x rooms (the way settlements always were)', () => {
    const p = priceWith(pricing, { ...req, rooms: 2, adults: 4 });
    expect(isUniform(p.nights)).toBe(true);
    expect(settlementShape(booking(p, 2), breakdownOf(p, null))).toEqual({
      quantity: 6,
      rate: 5000,
    });
  });
  it('a booking made before rate plans existed has no breakdown and settles as before', () => {
    expect(
      settlementShape(
        { pricePerNight: 4000, total: 8000, nights: 2, rooms: 1 },
        null,
      ),
    ).toEqual({ quantity: 2, rate: 4000 });
  });
  it('a stay with different nightly prices, extras or meals is one line at the agreed total', () => {
    const weekend = priceWith(pricing, {
      ...req,
      checkIn: '2026-10-23',
      checkOut: '2026-10-26',
    }); // Fri, Sat, Sun nights
    expect(isUniform(weekend.nights)).toBe(false);
    expect(
      settlementShape(booking(weekend), breakdownOf(weekend, null)),
    ).toEqual({ quantity: 1, rate: weekend.total });
    const meals = priceWith(pricing, { ...req, mealPlan: 'BED_BREAKFAST' });
    expect(settlementShape(booking(meals), breakdownOf(meals, null))).toEqual({
      quantity: 1,
      rate: meals.total,
    });
  });
  it("whichever shape, the sale's net total equals the booking total", () => {
    for (const p of [
      priceWith(pricing, req),
      priceWith(pricing, {
        ...req,
        checkIn: '2026-10-23',
        checkOut: '2026-10-26',
      }),
      priceWith(pricing, { ...req, adults: 3 }),
    ]) {
      const s = settlementShape(booking(p), breakdownOf(p, null));
      expect(Math.round(s.quantity * s.rate * 100)).toBe(
        Math.round(p.total * 100),
      );
    }
  });
});

describe('restitch / legacyNights / netPerNight', () => {
  it('puts kept nights and new nights back together with the right totals', () => {
    const old = priceStay({
      ...req,
      card: pricing.card,
      seasons: [],
      meals: {},
    }).nights; // 3 nights x 5,000
    const fresh = priceWith(
      { ...pricing, card: { ...pricing.card, baseRate: 6000 } },
      { ...req, checkOut: '2026-10-30' },
    ).nights;
    const kept = restitch(
      fresh.map((n) => old.find((o) => o.date === n.date) ?? n),
      1,
    );
    expect(kept.nights.map((n) => n.total)).toEqual([5000, 5000, 5000, 6000]);
    expect(kept.total).toBe(21000);
    expect(kept.averageRate).toBe(5250);
    expect(kept.uniform).toBe(false);
  });
  it("an old booking's nights are its price per night for every night", () => {
    const nights = legacyNights({ pricePerNight: 4000, rooms: 2 }, [
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(nights.map((n) => n.total)).toEqual([8000, 8000]);
    expect(restitch(nights, 2).averageRate).toBe(4000);
  });
  it('netPerNight uses the agreed nights, or spreads the old price', () => {
    const p = priceWith(pricing, {
      ...req,
      checkIn: '2026-10-23',
      checkOut: '2026-10-25',
    });
    expect(
      netPerNight(breakdownOf(p, null), { rate: 1, rooms: 1, nights: 2 }),
    ).toEqual([6500, 6500]);
    expect(netPerNight(null, { rate: 4000, rooms: 2, nights: 3 })).toEqual([
      8000, 8000, 8000,
    ]);
  });
  it('reads a stored breakdown back, and ignores junk', () => {
    const p = priceWith(pricing, req);
    expect(
      readBreakdown(JSON.parse(JSON.stringify(breakdownOf(p, 4000))))?.flatRate,
    ).toBe(4000);
    expect(readBreakdown(null)).toBeNull();
    expect(readBreakdown({ nope: true })).toBeNull();
  });
});
