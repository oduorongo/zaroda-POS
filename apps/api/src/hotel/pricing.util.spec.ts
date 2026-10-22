import {
  MEAL_PLANS,
  nightDates,
  occupancyProblem,
  priceNight,
  priceStay,
  PriceInput,
  RateCard,
  seasonFor,
} from './pricing.util';

// 2026-10-22 is a Thursday: the 23rd is a Friday, the 24th a Saturday, the 25th a Sunday.
const card = (over: Partial<RateCard> = {}): RateCard => ({
  baseRate: 5000,
  weekendRate: null,
  weekendDays: [5, 6],
  includedAdults: 2,
  freeChildren: 0,
  extraAdultRate: 0,
  extraChildRate: 0,
  ...over,
});
const input = (over: Partial<PriceInput> = {}): PriceInput => ({
  checkIn: '2026-10-26', // Monday
  checkOut: '2026-10-29',
  rooms: 1,
  adults: 2,
  children: 0,
  mealPlan: 'ROOM_ONLY',
  card: card(),
  seasons: [],
  meals: {},
  ...over,
});

describe('nightDates', () => {
  it('lists the nights of a stay and leaves out the day of departure', () => {
    expect(nightDates('2026-10-26', '2026-10-29')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
    expect(nightDates('2026-10-26', '2026-10-27')).toEqual(['2026-10-26']);
    expect(nightDates('2026-10-26', '2026-10-26')).toEqual([]);
  });
  it('crosses a month and a year end', () => {
    expect(nightDates('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
  });
});

describe('base price', () => {
  it('is rate x rooms x nights, and "uniform"', () => {
    const p = priceStay(input());
    expect(p.total).toBe(15000);
    expect(p.roomTotal).toBe(15000);
    expect(p.uniform).toBe(true);
    expect(p.averageRate).toBe(5000);
    expect(p.nights.map((n) => n.source)).toEqual(['BASE', 'BASE', 'BASE']);
  });
  it('multiplies by rooms', () => {
    expect(priceStay(input({ rooms: 3, adults: 6 })).total).toBe(45000);
  });
  it('keeps cents exact', () => {
    expect(priceStay(input({ card: card({ baseRate: 3333.33 }) })).total).toBe(
      9999.99,
    );
  });
  it('a stay of no nights costs nothing', () => {
    const p = priceStay(input({ checkOut: '2026-10-26' }));
    expect(p.total).toBe(0);
    expect(p.uniform).toBe(false);
  });
});

describe('weekend price', () => {
  const weekendCard = card({ weekendRate: 6500 });
  it('applies on Friday and Saturday nights only', () => {
    const p = priceStay(
      input({
        checkIn: '2026-10-22',
        checkOut: '2026-10-26',
        card: weekendCard,
      }),
    ); // Thu Fri Sat Sun nights
    expect(p.nights.map((n) => [n.date, n.rate, n.source])).toEqual([
      ['2026-10-22', 5000, 'BASE'],
      ['2026-10-23', 6500, 'WEEKEND'],
      ['2026-10-24', 6500, 'WEEKEND'],
      ['2026-10-25', 5000, 'BASE'],
    ]);
    expect(p.total).toBe(23000);
    expect(p.uniform).toBe(false);
  });
  it('the night counted is the night of that date (leaving on Saturday does not charge a weekend night)', () => {
    const p = priceStay(
      input({
        checkIn: '2026-10-22',
        checkOut: '2026-10-24',
        card: weekendCard,
      }),
    ); // nights Thu, Fri
    expect(p.total).toBe(5000 + 6500);
  });
  it('uses whichever days the hotel chose', () => {
    const p = priceStay(
      input({
        checkIn: '2026-10-25',
        checkOut: '2026-10-27',
        card: card({ weekendRate: 7000, weekendDays: [0] }),
      }),
    ); // Sun, Mon
    expect(p.nights.map((n) => n.rate)).toEqual([7000, 5000]);
  });
  it('with no weekend price set, weekends cost the base price', () => {
    expect(
      priceStay(input({ checkIn: '2026-10-23', checkOut: '2026-10-25' }))
        .uniform,
    ).toBe(true);
  });
});

describe('seasons', () => {
  const festive = {
    name: 'Festive',
    startDate: '2026-12-20',
    endDate: '2027-01-05',
    rate: 9000,
    weekendRate: null,
  };
  it('a season replaces the base price for the nights it covers, both ends included', () => {
    const p = priceStay(
      input({
        checkIn: '2026-12-19',
        checkOut: '2026-12-22',
        seasons: [festive],
      }),
    );
    expect(p.nights.map((n) => [n.rate, n.source, n.seasonName])).toEqual([
      [5000, 'BASE', null],
      [9000, 'SEASON', 'Festive'],
      [9000, 'SEASON', 'Festive'],
    ]);
    const last = priceStay(
      input({
        checkIn: '2027-01-05',
        checkOut: '2027-01-07',
        seasons: [festive],
      }),
    );
    expect(last.nights.map((n) => n.rate)).toEqual([9000, 5000]);
  });
  it('a season weekend price beats the plain weekend price on a weekend night', () => {
    const s = {
      ...festive,
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      rate: 8000,
      weekendRate: 11000,
    };
    const p = priceStay(
      input({
        checkIn: '2026-12-03',
        checkOut: '2026-12-06',
        card: card({ weekendRate: 6500 }),
        seasons: [s],
      }),
    ); // Thu Fri Sat nights
    expect(p.nights.map((n) => [n.rate, n.source])).toEqual([
      [8000, 'SEASON'],
      [11000, 'SEASON_WEEKEND'],
      [11000, 'SEASON_WEEKEND'],
    ]);
  });
  it('a season with no weekend price uses its own price on weekends too (not the plain weekend price)', () => {
    const p = priceStay(
      input({
        checkIn: '2026-12-04',
        checkOut: '2026-12-05',
        card: card({ weekendRate: 6500 }),
        seasons: [
          {
            ...festive,
            startDate: '2026-12-01',
            endDate: '2026-12-31',
            rate: 8000,
          },
        ],
      }),
    );
    expect(p.nights[0]).toMatchObject({ rate: 8000, source: 'SEASON' });
  });
  it('where two seasons overlap, the one that starts later (the more specific) wins', () => {
    const wide = {
      name: 'High',
      startDate: '2026-12-01',
      endDate: '2027-01-31',
      rate: 7000,
      weekendRate: null,
    };
    expect(seasonFor('2026-12-25', [wide, festive])?.name).toBe('Festive');
    expect(seasonFor('2026-12-25', [festive, wide])?.name).toBe('Festive');
    expect(seasonFor('2026-12-10', [wide, festive])?.name).toBe('High');
    expect(seasonFor('2026-11-30', [wide, festive])).toBeNull();
  });
  it('a stay across a season boundary is priced night by night', () => {
    const p = priceStay(
      input({
        checkIn: '2026-12-18',
        checkOut: '2026-12-22',
        seasons: [festive],
      }),
    );
    expect(p.total).toBe(5000 + 5000 + 9000 + 9000);
    expect(p.averageRate).toBe(7000);
    expect(p.uniform).toBe(false);
  });
});

describe('extra guests', () => {
  const guests = card({
    extraAdultRate: 1500,
    extraChildRate: 800,
    freeChildren: 1,
  });
  it('an extra adult beyond what a room includes pays every night', () => {
    const p = priceStay(input({ adults: 3, card: guests }));
    expect(p.nights[0]).toMatchObject({
      extraAdults: 1,
      extraCharge: 1500,
      total: 6500,
    });
    expect(p.extraTotal).toBe(4500);
    expect(p.total).toBe(15000 + 4500);
    expect(p.uniform).toBe(false);
  });
  it('the included adults and free children scale with the number of rooms', () => {
    expect(
      priceStay(input({ rooms: 2, adults: 4, children: 2, card: guests }))
        .extraTotal,
    ).toBe(0);
    const p = priceStay(
      input({ rooms: 2, adults: 5, children: 3, card: guests }),
    );
    expect(p.nights[0]).toMatchObject({
      extraAdults: 1,
      extraChildren: 1,
      extraCharge: 1500 + 800,
    });
  });
  it('children beyond the free ones pay the child rate', () => {
    expect(
      priceStay(input({ children: 2, card: guests })).nights[0],
    ).toMatchObject({ extraChildren: 1, extraCharge: 800 });
    expect(priceStay(input({ children: 1, card: guests })).extraTotal).toBe(0);
  });
  it('no extra charge when the rates are zero', () => {
    expect(priceStay(input({ adults: 4, children: 3 })).uniform).toBe(true);
  });
});

describe('meal plans', () => {
  const meals = {
    BED_BREAKFAST: { adult: 800, child: 400 },
    HALF_BOARD: { adult: 1800, child: 900 },
    FULL_BOARD: { adult: 2500, child: 1250 },
  };
  it('room only adds nothing', () => {
    expect(priceStay(input({ meals })).mealTotal).toBe(0);
  });
  it('is per person per night, children at their own price', () => {
    const p = priceStay(
      input({ adults: 2, children: 1, mealPlan: 'BED_BREAKFAST', meals }),
    );
    expect(p.nights[0].mealCharge).toBe(2 * 800 + 400);
    expect(p.mealTotal).toBe(3 * 2000);
    expect(p.total).toBe(15000 + 6000);
    expect(p.uniform).toBe(false);
  });
  it('each plan uses its own price', () => {
    const total = (mealPlan: PriceInput['mealPlan']) =>
      priceStay(input({ mealPlan, meals })).mealTotal;
    expect([
      total('BED_BREAKFAST'),
      total('HALF_BOARD'),
      total('FULL_BOARD'),
    ]).toEqual([4800, 10800, 15000]);
  });
  it('a plan the hotel has not priced adds nothing', () => {
    expect(
      priceStay(input({ mealPlan: 'FULL_BOARD', meals: {} })).mealTotal,
    ).toBe(0);
  });
  it('offers the four plans', () => {
    expect(MEAL_PLANS.map((m) => m.key)).toEqual([
      'ROOM_ONLY',
      'BED_BREAKFAST',
      'HALF_BOARD',
      'FULL_BOARD',
    ]);
  });
});

describe('everything together (and the same answer however it is asked)', () => {
  it('weekend + season + extras + meals add up night by night', () => {
    const p = priceStay({
      checkIn: '2026-12-23', // Wed
      checkOut: '2026-12-26', // nights Wed, Thu, Fri
      rooms: 1,
      adults: 3,
      children: 1,
      mealPlan: 'HALF_BOARD',
      card: card({
        weekendRate: 6500,
        extraAdultRate: 1500,
        extraChildRate: 800,
      }),
      seasons: [
        {
          startDate: '2026-12-20',
          endDate: '2027-01-05',
          rate: 9000,
          weekendRate: 12000,
        },
      ],
      meals: { HALF_BOARD: { adult: 1800, child: 900 } },
    });
    // Wed/Thu: 9000 + 1500 + 800 + (3x1800 + 900) = 17,600 ; Fri (season weekend): 12000 + 1500 + 800 + 6300 = 20,600
    expect(p.nights.map((n) => n.total)).toEqual([17600, 17600, 20600]);
    expect(p.total).toBe(55800);
    expect(p.roomTotal).toBe(30000);
    expect(p.extraTotal).toBe(3 * 2300);
    expect(p.mealTotal).toBe(3 * 6300);
  });
  it('priceNight and priceStay agree', () => {
    const i = input({
      checkIn: '2026-10-23',
      checkOut: '2026-10-24',
      card: card({ weekendRate: 6500 }),
    });
    expect(priceNight('2026-10-23', i).total).toBe(priceStay(i).total);
  });
});

describe('occupancyProblem', () => {
  it('needs a room, an adult, and no more guests than the rooms sleep', () => {
    expect(occupancyProblem({ rooms: 0, adults: 1, children: 0 }, 2)).toMatch(
      /at least one room/,
    );
    expect(occupancyProblem({ rooms: 1, adults: 0, children: 1 }, 2)).toMatch(
      /adult/,
    );
    expect(occupancyProblem({ rooms: 1, adults: 2, children: -1 }, 2)).toMatch(
      /negative/,
    );
    expect(occupancyProblem({ rooms: 1, adults: 2, children: 1 }, 2)).toMatch(
      /sleeps up to 2/,
    );
    expect(
      occupancyProblem({ rooms: 2, adults: 3, children: 1 }, 2),
    ).toBeNull();
    expect(
      occupancyProblem({ rooms: 1, adults: 1, children: 0 }, 2),
    ).toBeNull();
  });
});
