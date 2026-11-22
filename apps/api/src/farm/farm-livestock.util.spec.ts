import { addDays, ageText, expectedBirth, limitOf, nextDue, signedChange, todayKey, withdrawalState, withdrawalUntil } from './farm-livestock.util';
import { reminderText, toRemind } from './farm-reminders.service';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('farm livestock rules', () => {
  it('adds days across months and years', () => {
    expect(addDays('2027-01-30', 3)).toBe('2027-02-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('uses East Africa time for today', () => {
    expect(todayKey(new Date('2027-01-14T22:30:00Z'))).toBe('2027-01-15');
    expect(todayKey(new Date('2027-01-14T20:30:00Z'))).toBe('2027-01-14');
  });

  it('counts poultry as birds, fish and bees as neither', () => {
    expect(limitOf('CATTLE')).toBe('head');
    expect(limitOf('RABBIT')).toBe('head');
    expect(limitOf('CHICKEN')).toBe('birds');
    expect(limitOf('FISH')).toBeNull();
    expect(limitOf('BEE')).toBeNull();
  });

  it('sets withdrawal ends from the drug days', () => {
    expect(withdrawalUntil('2027-01-10', 3)).toBe('2027-01-13');
    expect(withdrawalUntil('2027-01-10', 0)).toBeNull();
  });

  it('blocks sales while any unvoided withdrawal runs, using the latest end', () => {
    const events = [
      { milkWithdrawalUntil: d('2027-01-13'), meatWithdrawalUntil: d('2027-01-30'), eggWithdrawalUntil: null },
      { milkWithdrawalUntil: d('2027-01-20'), meatWithdrawalUntil: null, eggWithdrawalUntil: null },
      { milkWithdrawalUntil: d('2027-02-20'), meatWithdrawalUntil: d('2027-03-01'), eggWithdrawalUntil: null, voidedAt: new Date() },
    ];
    expect(withdrawalState(events, '2027-01-12')).toEqual({ milkUntil: '2027-01-20', meatUntil: '2027-01-30', eggUntil: null });
    expect(withdrawalState(events, '2027-01-20')).toEqual({ milkUntil: null, meatUntil: '2027-01-30', eggUntil: null });
    expect(withdrawalState(events, '2027-01-30')).toEqual({ milkUntil: null, meatUntil: null, eggUntil: null });
  });

  it('expects births by species gestation', () => {
    expect(expectedBirth('CATTLE', '2027-01-01')).toBe(addDays('2027-01-01', 283));
    expect(expectedBirth('GOAT', '2027-01-01')).toBe('2027-05-31');
    expect(expectedBirth('CHICKEN', '2027-01-01')).toBeNull();
  });

  it('schedules programme doses after the last dose, else at the first age, never in the past', () => {
    const p = { firstAgeDays: 90, intervalDays: 180 };
    expect(nextDue(p, { born: null, lastDone: '2027-01-01' }, '2027-02-01')).toBe('2027-06-30');
    expect(nextDue(p, { born: '2027-01-01', lastDone: null }, '2027-01-10')).toBe('2027-04-01');
    expect(nextDue(p, { born: '2025-01-01', lastDone: null }, '2027-01-10')).toBe('2027-01-10');
    expect(nextDue({ firstAgeDays: null, intervalDays: 30 }, { born: null, lastDone: null }, '2027-01-10')).toBe('2027-01-10');
  });

  it('signs head-count changes by reason', () => {
    expect(signedChange('BOUGHT', 5)).toBe(5);
    expect(signedChange('DIED', 2)).toBe(-2);
    expect(signedChange('SOLD', -3)).toBe(-3);
    expect(signedChange('ADJUSTED', -4)).toBe(-4);
  });

  it('writes ages plainly', () => {
    expect(ageText('2023-03-10', '2027-05-20')).toBe('4 yr 2 mo');
    expect(ageText('2027-05-01', '2027-05-20')).toBe('19 days');
    expect(ageText(null, '2027-05-20')).toBe('');
  });
});

describe('farm reminders', () => {
  const today = '2027-01-10';
  const t = (id: string, due: string, reminded: string | null = null) => ({ id, title: id, dueOn: d(due), remindedOn: reminded ? d(reminded) : null });

  it('reminds 7, 3 and 1 days before, on the day, and once when overdue', () => {
    const picked = toRemind(
      [
        t('in7', '2027-01-17'),
        t('in5', '2027-01-15'),
        t('in3', '2027-01-13'),
        t('in1', '2027-01-11'),
        t('today', '2027-01-10'),
        t('overdue-new', '2027-01-05', '2027-01-04'),
        t('overdue-done', '2027-01-05', '2027-01-05'),
        t('already', '2027-01-10', '2027-01-10'),
      ],
      today,
    ).map((x) => x.id);
    expect(picked).toEqual(['in7', 'in3', 'in1', 'today', 'overdue-new']);
  });

  it('writes a short text with at most five lines', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => t(x, addDays(today, i - 1)));
    const text = reminderText('Uriri Farm', tasks, today, 'https://shamba.example/shamba/health');
    expect(text).toContain('a - overdue');
    expect(text).toContain('b - today');
    expect(text).toContain('c - tomorrow');
    expect(text).toContain('+1 more');
    expect(text).not.toContain('f -');
  });
});
