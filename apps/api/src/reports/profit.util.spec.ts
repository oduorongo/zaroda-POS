import { addDays, bucketKey, dayStart, defaultGroupBy, isValidDay, listBuckets, nairobiDayOf, rangeProblem, weekStartOf } from './profit.util';

describe('Nairobi days', () => {
  it('puts a late-evening UTC moment on the next Nairobi day', () => {
    expect(nairobiDayOf(new Date('2026-10-20T20:59:00Z'))).toBe('2026-10-20'); // 11:59pm in Nairobi
    expect(nairobiDayOf(new Date('2026-10-20T21:00:00Z'))).toBe('2026-10-21'); // midnight in Nairobi
  });

  it('starts a day at midnight Nairobi time', () => {
    expect(dayStart('2026-10-21').toISOString()).toBe('2026-10-20T21:00:00.000Z');
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects dates that do not exist', () => {
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2026-10-21')).toBe(true);
    expect(isValidDay('21/10/2026')).toBe(false);
  });
});

describe('weeks run Monday to Sunday', () => {
  it('finds the Monday', () => {
    expect(weekStartOf('2026-10-21')).toBe('2026-10-19'); // a Wednesday
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19'); // the Monday itself
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19'); // the Sunday
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26'); // next Monday
  });

  it('groups by day, week and month', () => {
    expect(bucketKey('2026-10-21', 'day')).toBe('2026-10-21');
    expect(bucketKey('2026-10-21', 'week')).toBe('2026-10-19');
    expect(bucketKey('2026-10-21', 'month')).toBe('2026-10');
  });
});

describe('listBuckets', () => {
  it('lists every day, even quiet ones', () => {
    expect(listBuckets('2026-10-29', '2026-11-02', 'day')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('lists each week once, starting from its Monday, even when the range starts mid-week', () => {
    expect(listBuckets('2026-10-21', '2026-11-03', 'week')).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });

  it('lists each month once across a year end', () => {
    expect(listBuckets('2026-11-15', '2027-01-10', 'month')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('rangeProblem', () => {
  it('accepts a normal range', () => {
    expect(rangeProblem('2026-10-01', '2026-10-31')).toBeNull();
    expect(rangeProblem('2026-10-21', '2026-10-21')).toBeNull();
  });

  it('refuses a backwards, broken or oversized range', () => {
    expect(rangeProblem('2026-10-31', '2026-10-01')).toMatch(/before/);
    expect(rangeProblem('nope', '2026-10-01')).toMatch(/start and an end/);
    expect(rangeProblem('2025-01-01', '2026-10-01')).toMatch(/year/);
  });
});

describe('defaultGroupBy', () => {
  it('uses days for a month, weeks for a few months, months for a year', () => {
    expect(defaultGroupBy('2026-10-01', '2026-10-31')).toBe('day');
    expect(defaultGroupBy('2026-07-01', '2026-10-31')).toBe('week');
    expect(defaultGroupBy('2026-01-01', '2026-12-31')).toBe('month');
  });
});
