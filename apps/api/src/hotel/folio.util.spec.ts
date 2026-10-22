import { Role } from '@prisma/client';
import {
  allocateToSettlement,
  checkInProblem,
  checkOutProblem,
  folioBalance,
  folioTotals,
  nightEntries,
  parseRoomChargeReference,
  quantityFor,
  roomChargeReference,
  roomStatusProblem,
  settlementClientId,
  signedAmount,
} from './folio.util';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('folio balance', () => {
  it('a payment lowers what is owed; charges, nights and refunds raise it; an adjustment is signed', () => {
    expect(signedAmount('PAYMENT', 100)).toBe(-100);
    expect(signedAmount('ROOM_NIGHT', 100)).toBe(100);
    expect(signedAmount('ADJUSTMENT', -50)).toBe(-50);
    const entries = [
      { type: 'ROOM_NIGHT' as const, amount: 5000 },
      { type: 'ROOM_NIGHT' as const, amount: 5000 },
      { type: 'CHARGE' as const, amount: 1250.5 },
      { type: 'PAYMENT' as const, amount: 3000 },
      { type: 'ADJUSTMENT' as const, amount: -500 },
      { type: 'REFUND' as const, amount: 200 },
    ];
    expect(folioBalance(entries)).toBe(7950.5);
  });

  it('keeps cents exact (no floating point drift)', () => {
    const entries = Array.from({ length: 10 }, () => ({
      type: 'CHARGE' as const,
      amount: 0.1,
    }));
    expect(folioBalance(entries)).toBe(1);
    expect(
      folioBalance([...entries, { type: 'PAYMENT' as const, amount: 1 }]),
    ).toBe(0);
  });

  it('sums by kind for the printed folio', () => {
    const t = folioTotals([
      { type: 'ROOM_NIGHT', amount: 5800, taxAmount: 800 },
      { type: 'ROOM_NIGHT', amount: 5800, taxAmount: 800 },
      { type: 'CHARGE', amount: 300 },
      { type: 'PAYMENT', amount: 4000 },
    ]);
    expect(t).toMatchObject({
      roomNights: 11600,
      roomTax: 1600,
      charges: 300,
      payments: 4000,
      balance: 7900,
    });
  });
});

describe('nightEntries', () => {
  it('splits a stay into one entry per night that adds up exactly to rate x rooms x nights plus tax', () => {
    const e = nightEntries(5000, 1, 3, 0.16);
    expect(e).toHaveLength(3);
    expect(e.map((x) => x.amount)).toEqual([5800, 5800, 5800]);
    expect(e.reduce((a, b) => a + b.taxAmount, 0)).toBeCloseTo(2400, 10);
  });

  it('puts the odd cents on the last night so the total is exactly right', () => {
    const e = nightEntries(3333.33, 1, 3, 0.16);
    const total = e.reduce((a, b) => a + Math.round(b.amount * 100), 0);
    expect(total).toBe(Math.round(3333.33 * 3 * 1.16 * 100));
    expect(e[0].amount).toBe(e[1].amount);
  });

  it('works with several rooms, no tax, and a one-night stay', () => {
    expect(nightEntries(4000, 2, 2, 0).map((x) => x.amount)).toEqual([
      8000, 8000,
    ]);
    expect(nightEntries(4000, 1, 1, 0.16)).toEqual([
      { amount: 4640, taxAmount: 640 },
    ]);
    expect(nightEntries(4000, 1, 0, 0.16)).toEqual([]);
  });
});

describe('allocateToSettlement', () => {
  const pay = (id: string, amount: number, day: number, method = 'CASH') => ({
    id,
    method,
    amount,
    reference: null,
    createdAt: new Date(2026, 9, day),
  });

  it('applies the oldest payments first, in their own methods, up to the room total', () => {
    const r = allocateToSettlement(10000, [
      pay('b', 7000, 3, 'CARD'),
      pay('a', 3000, 1, 'MPESA_RECEIPT'),
      pay('c', 5000, 5),
    ]);
    expect(r.allocations).toEqual([
      { entryId: 'a', method: 'MPESA_RECEIPT', amount: 3000, reference: null },
      { entryId: 'b', method: 'CARD', amount: 7000, reference: null },
    ]);
    expect(r.unpaid).toBe(0);
  });

  it('uses only part of a payment when it is more than is needed', () => {
    const r = allocateToSettlement(4000, [pay('a', 6000, 1)]);
    expect(r.allocations).toEqual([
      { entryId: 'a', method: 'CASH', amount: 4000, reference: null },
    ]);
  });

  it('says how much is left unpaid', () => {
    expect(allocateToSettlement(10000, [pay('a', 2500.5, 1)]).unpaid).toBe(
      7499.5,
    );
    expect(allocateToSettlement(10000, []).unpaid).toBe(10000);
  });
});

describe('checkInProblem', () => {
  const checkIn = d('2026-11-10');
  const checkOut = d('2026-11-12');

  it('allows check-in on or after the arrival date, until the check-out date', () => {
    expect(
      checkInProblem(d('2026-11-10'), checkIn, checkOut, Role.CASHIER, false),
    ).toBeNull();
    expect(
      checkInProblem(d('2026-11-11'), checkIn, checkOut, Role.CASHIER, false),
    ).toBeNull();
    expect(
      checkInProblem(d('2026-11-12'), checkIn, checkOut, Role.MANAGER, false),
    ).toMatch(/already passed/);
  });

  it('refuses an early check-in unless a manager allows it', () => {
    expect(
      checkInProblem(d('2026-11-09'), checkIn, checkOut, Role.CASHIER, false),
    ).toMatch(/opens on 2026-11-10/);
    expect(
      checkInProblem(d('2026-11-09'), checkIn, checkOut, Role.CASHIER, true),
    ).toMatch(/manager or owner/);
    expect(
      checkInProblem(d('2026-11-09'), checkIn, checkOut, Role.SUPERVISOR, true),
    ).toMatch(/manager or owner/);
    expect(
      checkInProblem(d('2026-11-09'), checkIn, checkOut, Role.MANAGER, true),
    ).toBeNull();
    expect(
      checkInProblem(d('2026-11-09'), checkIn, checkOut, Role.OWNER, true),
    ).toBeNull();
  });
});

describe('checkOutProblem', () => {
  it('lets a settled folio check out', () => {
    expect(checkOutProblem(0, Role.CASHIER, undefined)).toBeNull();
    expect(checkOutProblem(0.004, Role.CASHIER, undefined)).toBeNull();
  });
  it('needs the balance paid, or a manager with a reason', () => {
    expect(checkOutProblem(1500, Role.CASHIER, undefined)).toMatch(
      /still owes KES 1500.00/,
    );
    expect(checkOutProblem(-200, Role.CASHIER, undefined)).toMatch(
      /overpaid by KES 200.00/,
    );
    expect(checkOutProblem(1500, Role.CASHIER, 'Company will pay')).toMatch(
      /manager or owner/,
    );
    expect(checkOutProblem(1500, Role.MANAGER, 'ab')).toMatch(/why/i);
    expect(
      checkOutProblem(1500, Role.MANAGER, 'Company will pay by cheque'),
    ).toBeNull();
  });
});

describe('roomStatusProblem', () => {
  it('occupied is only set by checking in, and not while a guest is in', () => {
    expect(roomStatusProblem(Role.OWNER, 'VACANT_CLEAN', 'OCCUPIED')).toMatch(
      /checking a guest in/,
    );
    expect(roomStatusProblem(Role.OWNER, 'OCCUPIED', 'VACANT_DIRTY')).toMatch(
      /guest is in/,
    );
  });
  it('out of order needs a supervisor; clean and dirty do not', () => {
    expect(
      roomStatusProblem(Role.CASHIER, 'VACANT_DIRTY', 'VACANT_CLEAN'),
    ).toBeNull();
    expect(
      roomStatusProblem(Role.CASHIER, 'VACANT_CLEAN', 'VACANT_DIRTY'),
    ).toBeNull();
    expect(
      roomStatusProblem(Role.CASHIER, 'VACANT_CLEAN', 'OUT_OF_ORDER'),
    ).toMatch(/supervisor/);
    expect(
      roomStatusProblem(Role.SUPERVISOR, 'VACANT_CLEAN', 'OUT_OF_ORDER'),
    ).toBeNull();
  });
});

describe('quantityFor', () => {
  it('follows the number of active rooms once there are any, else keeps the hand-set number', () => {
    expect(quantityFor(6, 3)).toBe(6);
    expect(quantityFor(0, 3)).toBe(3);
  });
});

describe('room charge references', () => {
  const booking = '11111111-1111-4111-8111-111111111111';
  it('round-trips the booking and is unique per sale', () => {
    const a = roomChargeReference(booking, 'sale-a');
    expect(a).not.toBe(roomChargeReference(booking, 'sale-b'));
    expect(parseRoomChargeReference(a)).toEqual({ bookingId: booking });
  });
  it('rejects anything that is not a room reference', () => {
    expect(parseRoomChargeReference('SETTLE:' + booking)).toBeNull();
    expect(parseRoomChargeReference('ROOM:not-a-booking:x')).toBeNull();
    expect(parseRoomChargeReference(null)).toBeNull();
  });
});

describe('settlementClientId', () => {
  it('is the same for the same stay and different for another', () => {
    expect(settlementClientId('a')).toBe(settlementClientId('a'));
    expect(settlementClientId('a')).not.toBe(settlementClientId('b'));
    expect(settlementClientId('a')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
