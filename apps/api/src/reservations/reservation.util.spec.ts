import { MAX_PARTY_SIZE, MIN_NOTICE_MINUTES, nowMinutesInKenya, parseTime, reservationProblem, timesClash } from './reservation.util';

// 2026-11-10 10:00 in Nairobi (07:00 UTC) - a Tuesday morning.
const now = new Date('2026-11-10T07:00:00Z');
const ok = { date: '2026-11-12', time: '19:30', partySize: 4 };

describe('parseTime', () => {
  it('reads 24-hour HH:MM only', () => {
    expect(parseTime('19:30')).toBe(1170);
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('7:30')).toBeNull();
    expect(parseTime('19:60')).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });
});

describe('nowMinutesInKenya', () => {
  it('is three hours ahead of UTC', () => {
    expect(nowMinutesInKenya(now)).toBe(10 * 60);
  });
});

describe('reservationProblem', () => {
  it('accepts a sensible request', () => {
    expect(reservationProblem(ok, now)).toBeNull();
  });

  it('wants a real date and time', () => {
    expect(reservationProblem({ ...ok, date: '2026-02-30' }, now)).toMatch(/date/);
    expect(reservationProblem({ ...ok, date: undefined }, now)).toMatch(/date/);
    expect(reservationProblem({ ...ok, time: '25:00' }, now)).toMatch(/time/);
    expect(reservationProblem({ ...ok, time: undefined }, now)).toMatch(/time/);
  });

  it('refuses a party of nobody, a part-person, or a crowd', () => {
    expect(reservationProblem({ ...ok, partySize: 0 }, now)).toMatch(/1 to/);
    expect(reservationProblem({ ...ok, partySize: 2.5 }, now)).toMatch(/1 to/);
    expect(reservationProblem({ ...ok, partySize: MAX_PARTY_SIZE + 1 }, now)).toMatch(/call the restaurant/);
    expect(reservationProblem({ ...ok, partySize: MAX_PARTY_SIZE }, now)).toBeNull();
  });

  it('refuses the past and the far future', () => {
    expect(reservationProblem({ ...ok, date: '2026-11-09' }, now)).toMatch(/passed/);
    expect(reservationProblem({ ...ok, date: '2027-03-01' }, now)).toMatch(/60 days/);
    expect(reservationProblem({ ...ok, date: '2027-01-09' }, now)).toBeNull(); // exactly 60 days ahead
  });

  it('wants some notice for today, but only for today', () => {
    expect(reservationProblem({ ...ok, date: '2026-11-10', time: '10:15' }, now)).toMatch(new RegExp(`${MIN_NOTICE_MINUTES} minutes`));
    expect(reservationProblem({ ...ok, date: '2026-11-10', time: '10:30' }, now)).toBeNull();
    expect(reservationProblem({ ...ok, date: '2026-11-10', time: '09:00' }, now)).toMatch(/minutes/);
    expect(reservationProblem({ ...ok, date: '2026-11-11', time: '00:30' }, now)).toBeNull();
  });
});

describe('timesClash', () => {
  it('two sittings less than two hours apart clash', () => {
    expect(timesClash('19:00', '20:30')).toBe(true);
    expect(timesClash('19:00', '19:00')).toBe(true);
    expect(timesClash('20:30', '19:00')).toBe(true);
  });
  it('two hours or more apart do not', () => {
    expect(timesClash('19:00', '21:00')).toBe(false);
    expect(timesClash('12:00', '19:00')).toBe(false);
  });
  it('unreadable times never block anything', () => {
    expect(timesClash('soon', '19:00')).toBe(false);
  });
});
