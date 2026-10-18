import { bookingHoldsRooms, depositFor, eachNight, nightsBetween, parseDay, roomsTaken, stayProblem, stayTotal, todayInKenya } from './room-availability.util';

const d = (s: string) => parseDay(s) as Date;

describe('parseDay', () => {
  it('reads real calendar days only', () => {
    expect(parseDay('2026-11-05')?.toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('05/11/2026')).toBeNull();
    expect(parseDay('')).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });
});

describe('todayInKenya', () => {
  it('rolls to the next day at 21:00 UTC (midnight in Nairobi)', () => {
    expect(todayInKenya(new Date('2026-11-05T20:59:00Z')).toISOString().slice(0, 10)).toBe('2026-11-05');
    expect(todayInKenya(new Date('2026-11-05T21:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-06');
  });
});

describe('stays', () => {
  it('counts nights from check-in up to, but not including, check-out', () => {
    expect(nightsBetween(d('2026-11-05'), d('2026-11-08'))).toBe(3);
    expect(eachNight(d('2026-11-05'), d('2026-11-08')).map((n) => n.toISOString().slice(0, 10))).toEqual(['2026-11-05', '2026-11-06', '2026-11-07']);
  });

  it('rejects missing, past, reversed and over-long stays', () => {
    const today = d('2026-11-05');
    expect(stayProblem(null, d('2026-11-08'), today)).toMatch(/Choose/);
    expect(stayProblem(d('2026-11-04'), d('2026-11-08'), today)).toMatch(/passed/);
    expect(stayProblem(d('2026-11-08'), d('2026-11-08'), today)).toMatch(/after check-in/);
    expect(stayProblem(d('2026-11-08'), d('2026-11-07'), today)).toMatch(/after check-in/);
    expect(stayProblem(d('2026-11-05'), d('2026-12-20'), today)).toMatch(/30 nights/);
  });

  it('accepts a stay that starts today', () => {
    expect(stayProblem(d('2026-11-05'), d('2026-11-06'), d('2026-11-05'))).toBeNull();
  });
});

describe('roomsTaken', () => {
  const held = [
    { checkIn: d('2026-11-05'), checkOut: d('2026-11-08'), rooms: 2 },
    { checkIn: d('2026-11-07'), checkOut: d('2026-11-10'), rooms: 1 },
  ];

  it('is the busiest night of the stay, not the total', () => {
    expect(roomsTaken(held, d('2026-11-05'), d('2026-11-10'))).toBe(3); // the night of the 7th has both
    expect(roomsTaken(held, d('2026-11-05'), d('2026-11-07'))).toBe(2);
    expect(roomsTaken(held, d('2026-11-08'), d('2026-11-10'))).toBe(1);
  });

  it('lets one guest leave the morning another arrives (no clash on the check-out day)', () => {
    expect(roomsTaken([{ checkIn: d('2026-11-05'), checkOut: d('2026-11-08'), rooms: 5 }], d('2026-11-08'), d('2026-11-09'))).toBe(0);
  });

  it('is zero when nothing overlaps', () => {
    expect(roomsTaken(held, d('2026-12-01'), d('2026-12-03'))).toBe(0);
    expect(roomsTaken([], d('2026-11-05'), d('2026-11-06'))).toBe(0);
  });
});

describe('bookingHoldsRooms', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  const later = new Date('2026-11-01T10:10:00Z');
  const earlier = new Date('2026-11-01T09:50:00Z');
  it('paid and checked-in bookings always hold their rooms', () => {
    expect(bookingHoldsRooms({ status: 'CONFIRMED', paymentDeadline: earlier }, now)).toBe(true);
    expect(bookingHoldsRooms({ status: 'CHECKED_IN', paymentDeadline: earlier }, now)).toBe(true);
  });
  it('an unpaid booking holds rooms only until its payment window closes', () => {
    expect(bookingHoldsRooms({ status: 'PENDING_PAYMENT', paymentDeadline: later }, now)).toBe(true);
    expect(bookingHoldsRooms({ status: 'PENDING_PAYMENT', paymentDeadline: earlier }, now)).toBe(false);
  });
  it('finished, cancelled, expired and no-show bookings hold nothing', () => {
    for (const status of ['CHECKED_OUT', 'CANCELLED', 'EXPIRED', 'NO_SHOW']) expect(bookingHoldsRooms({ status, paymentDeadline: later }, now)).toBe(false);
  });
});

describe('money', () => {
  it('prices price x nights x rooms', () => {
    expect(stayTotal(4500, 3, 2)).toBe(27000);
    expect(stayTotal(1999.5, 3, 1)).toBe(5998.5);
  });

  it('takes the deposit percentage of the whole stay, rounded up to a whole shilling', () => {
    expect(depositFor(10000, 30)).toBe(3000);
    expect(depositFor(5998.5, 30)).toBe(1800); // 1799.55 -> 1800
    expect(depositFor(1000, 33)).toBe(330);
  });

  it('never asks for less than KES 1 or more than the stay costs', () => {
    expect(depositFor(10000, 0)).toBe(1);
    expect(depositFor(10000, 100)).toBe(10000);
    expect(depositFor(10000, 250)).toBe(10000);
    expect(depositFor(0.5, 50)).toBe(1);
  });
});
