import { RestaurantTableStatus, Role } from '@prisma/client';
import {
  billTotals,
  floorStatus,
  openProblem,
  reservationStart,
  shareProportionally,
  splitEqual,
  voidProblem,
} from './tab-bill.util';

describe('billTotals', () => {
  it('adds price x quantity and VAT per line', () => {
    const t = billTotals([
      { quantity: 2, unitPrice: 150, taxRate: 0.16 },
      { quantity: 1, unitPrice: 80, taxRate: 0 },
    ]);
    expect(t).toEqual({
      subtotal: 380,
      tax: 48,
      discountAmount: 0,
      total: 428,
    });
  });

  it('takes a percent or fixed discount off the post-tax total', () => {
    const lines = [{ quantity: 2, unitPrice: 500, taxRate: 0.16 }];
    expect(billTotals(lines, { type: 'PERCENT', value: 10 }).total).toBe(1044);
    expect(billTotals(lines, { type: 'FIXED', value: 60 }).total).toBe(1100);
  });

  it('refuses a discount bigger than the bill', () => {
    expect(() =>
      billTotals([{ quantity: 1, unitPrice: 100, taxRate: 0 }], {
        type: 'FIXED',
        value: 101,
      }),
    ).toThrow();
    expect(() =>
      billTotals([{ quantity: 1, unitPrice: 100, taxRate: 0 }], {
        type: 'PERCENT',
        value: 101,
      }),
    ).toThrow();
  });

  it('handles weights and keeps cents exact', () => {
    expect(
      billTotals([{ quantity: 0.35, unitPrice: 199.99, taxRate: 0.16 }]).total,
    ).toBe(81.2);
  });
});

describe('splitEqual', () => {
  it('splits into parts that add back to the total, odd cents to the first payers', () => {
    expect(splitEqual(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(splitEqual(100, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(splitEqual(1000, 4)).toEqual([250, 250, 250, 250]);
  });
  it('needs at least one person', () => {
    expect(() => splitEqual(100, 0)).toThrow();
    expect(() => splitEqual(100, 1.5)).toThrow();
  });
});

describe('shareProportionally', () => {
  it('shares a tip by what each owes and adds back up exactly', () => {
    const shares = shareProportionally(100, [300, 100, 100]);
    expect(shares).toEqual([60, 20, 20]);
    const odd = shareProportionally(10, [1, 1, 1]);
    expect(odd.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10);
  });
  it('gives nothing when there is no tip', () => {
    expect(shareProportionally(0, [5, 5])).toEqual([0, 0]);
  });
});

describe('voidProblem', () => {
  it('only a supervisor or above may void, with a reason, an unpaid line', () => {
    expect(
      voidProblem(Role.CASHIER, { status: 'ORDERED' }, 'wrong dish'),
    ).toMatch(/supervisor/);
    expect(voidProblem(Role.SUPERVISOR, { status: 'ORDERED' }, '')).toMatch(
      /why/,
    );
    expect(voidProblem(Role.SUPERVISOR, { status: 'ORDERED' }, 'ab')).toMatch(
      /why/,
    );
    expect(
      voidProblem(Role.SUPERVISOR, { status: 'PAID' }, 'wrong dish'),
    ).toMatch(/paid/);
    expect(
      voidProblem(Role.MANAGER, { status: 'VOIDED' }, 'wrong dish'),
    ).toMatch(/already/);
    expect(
      voidProblem(
        Role.OWNER,
        { status: 'ORDERED' },
        'Guest changed their mind',
      ),
    ).toBeNull();
  });
});

describe('openProblem', () => {
  it('a table can only have one open bill', () => {
    expect(openProblem(true)).toMatch(/already/);
    expect(openProblem(false)).toBeNull();
  });
});

describe('floorStatus', () => {
  // 19:30 Nairobi = 16:30 UTC
  const reservation = {
    date: new Date('2026-10-22T00:00:00Z'),
    time: '19:30',
    guestName: 'Mrs Otieno',
    status: 'CONFIRMED',
  };
  const at = (iso: string) => new Date(iso);

  it('works out the start in Nairobi time', () => {
    expect(
      new Date(
        reservationStart(reservation.date, reservation.time),
      ).toISOString(),
    ).toBe('2026-10-22T16:30:00.000Z');
  });

  it('shows Reserved from an hour before until an hour after, if the table is free', () => {
    const show = (iso: string) =>
      floorStatus(RestaurantTableStatus.AVAILABLE, [reservation], 60, at(iso))
        .status;
    expect(show('2026-10-22T15:29:00Z')).toBe(RestaurantTableStatus.AVAILABLE);
    expect(show('2026-10-22T15:30:00Z')).toBe(RestaurantTableStatus.RESERVED);
    expect(show('2026-10-22T17:30:00Z')).toBe(RestaurantTableStatus.RESERVED);
    expect(show('2026-10-22T17:31:00Z')).toBe(RestaurantTableStatus.AVAILABLE);
  });

  it('uses the lead time that was set', () => {
    expect(
      floorStatus(
        RestaurantTableStatus.AVAILABLE,
        [reservation],
        30,
        at('2026-10-22T15:45:00Z'),
      ).status,
    ).toBe(RestaurantTableStatus.AVAILABLE);
    expect(
      floorStatus(
        RestaurantTableStatus.AVAILABLE,
        [reservation],
        120,
        at('2026-10-22T14:45:00Z'),
      ).status,
    ).toBe(RestaurantTableStatus.RESERVED);
  });

  it('never overrides an occupied table or one that needs cleaning', () => {
    const now = at('2026-10-22T16:30:00Z');
    expect(
      floorStatus(RestaurantTableStatus.OCCUPIED, [reservation], 60, now)
        .status,
    ).toBe(RestaurantTableStatus.OCCUPIED);
    expect(
      floorStatus(RestaurantTableStatus.NEEDS_CLEANING, [reservation], 60, now)
        .status,
    ).toBe(RestaurantTableStatus.NEEDS_CLEANING);
  });

  it('ignores reservations that are not confirmed, and says who it is held for', () => {
    const now = at('2026-10-22T16:30:00Z');
    expect(
      floorStatus(
        RestaurantTableStatus.AVAILABLE,
        [{ ...reservation, status: 'REQUESTED' }],
        60,
        now,
      ).status,
    ).toBe(RestaurantTableStatus.AVAILABLE);
    expect(
      floorStatus(
        RestaurantTableStatus.AVAILABLE,
        [{ ...reservation, status: 'SEATED' }],
        60,
        now,
      ).status,
    ).toBe(RestaurantTableStatus.AVAILABLE);
    expect(
      floorStatus(RestaurantTableStatus.AVAILABLE, [reservation], 60, now)
        .reservation,
    ).toEqual({ guestName: 'Mrs Otieno', time: '19:30' });
  });
});
