import { effectiveStatus } from '../platform-admin/subscriptions.util';
import { paidUntil, payInFull, reminderFor, reminderText, SeasonalRules, signupSchedule, yearSchedule } from './seasonal.util';

const rules: SeasonalRules = {
  terms: [
    { term: 1, label: 'Term 1', shareRate: 0.5, dueMonth: 1, dueDay: 15, graceDays: 30, fromMonth: 1, toMonth: 4 },
    { term: 2, label: 'Term 2', shareRate: 0.3, dueMonth: 5, dueDay: 15, graceDays: 30, fromMonth: 5, toMonth: 8 },
    { term: 3, label: 'Term 3', shareRate: 0.2, dueMonth: 9, dueDay: 15, graceDays: 30, fromMonth: 9, toMonth: 10 },
  ],
  minFirstPaymentKes: 1500,
  setupFeeKes: 0,
  payInFullDiscountRate: 0.1,
  payInFullUntilMonth: 1,
};
const brief = (l: { schoolYear: number; term: number; amount: number; dueDate: string }[]) => l.map((i) => `${i.schoolYear} T${i.term} ${i.amount} ${i.dueDate}`);

describe('seasonal billing: joining mid-year', () => {
  it('the whole year at 50 / 30 / 20', () => {
    expect(brief(yearSchedule(2027, 12000, rules.terms))).toEqual(['2027 T1 6000 2027-01-15', '2027 T2 3600 2027-05-15', '2027 T3 2400 2027-09-15']);
  });

  it('joining in the Term 1 window (Jan-Apr): all three terms; a Term 1 already past its date is due today', () => {
    expect(brief(signupSchedule('2027-01-05', 12000, rules))).toEqual(['2027 T1 6000 2027-01-15', '2027 T2 3600 2027-05-15', '2027 T3 2400 2027-09-15']);
    expect(brief(signupSchedule('2027-03-20', 12000, rules))).toEqual(['2027 T1 6000 2027-03-20', '2027 T2 3600 2027-05-15', '2027 T3 2400 2027-09-15']);
  });

  it('joining in the Term 2 window (May-Aug): Terms 2 and 3', () => {
    expect(brief(signupSchedule('2027-06-10', 12000, rules))).toEqual(['2027 T2 3600 2027-06-10', '2027 T3 2400 2027-09-15']);
  });

  it('joining in the Term 3 window (Sep-Oct): Term 3 only', () => {
    expect(brief(signupSchedule('2027-09-01', 12000, rules))).toEqual(['2027 T3 2400 2027-09-15']);
    expect(brief(signupSchedule('2027-10-31', 12000, rules))).toEqual(['2027 T3 2400 2027-10-31']);
  });

  it('joining Nov-Dec: nothing now, the first instalment is next January; a setup fee when one is set', () => {
    expect(brief(signupSchedule('2027-11-20', 12000, rules))).toEqual(['2028 T1 6000 2028-01-15', '2028 T2 3600 2028-05-15', '2028 T3 2400 2028-09-15']);
    expect(brief(signupSchedule('2027-12-31', 12000, { ...rules, setupFeeKes: 500 }))).toEqual(['2028 T0 500 2027-12-31', '2028 T1 6000 2028-01-15', '2028 T2 3600 2028-05-15', '2028 T3 2400 2028-09-15']);
  });

  it('the first instalment is at least the minimum first payment (setup fee aside); later ones are not raised', () => {
    expect(brief(signupSchedule('2027-09-02', 5000, rules))).toEqual(['2027 T3 1500 2027-09-15']);
    expect(brief(signupSchedule('2027-06-01', 4000, rules))).toEqual(['2027 T2 1500 2027-06-01', '2027 T3 800 2027-09-15']);
    expect(brief(signupSchedule('2027-11-01', 2000, { ...rules, setupFeeKes: 300 }))).toEqual(['2028 T0 300 2027-11-01', '2028 T1 1500 2028-01-15', '2028 T2 600 2028-05-15', '2028 T3 400 2028-09-15']);
  });
});

describe('seasonal billing: paying the whole year', () => {
  const year = yearSchedule(2027, 12000, rules.terms).map((i) => ({ ...i, status: 'DUE' }));

  it('in January, at the discount: 12,000 less 10% = 10,800', () => {
    expect(payInFull(year, 2027, '2027-01-20', rules)).toEqual({ available: true, full: 12000, discount: 1200, amount: 10800 });
  });

  it('not after January, not once a term is paid, not for another year', () => {
    expect(payInFull(year, 2027, '2027-02-01', rules).available).toBe(false);
    expect(payInFull([{ ...year[0], status: 'PAID' }, year[1], year[2]], 2027, '2027-01-20', rules).available).toBe(false);
    expect(payInFull(year, 2027, '2026-12-20', rules).available).toBe(false);
    expect(payInFull(year, 2027, '2027-03-01', { ...rules, payInFullUntilMonth: 3 }).available).toBe(true);
  });
});

describe('seasonal billing: grace, read-only and back to active', () => {
  const sub = (open: { dueDate: string; graceDays: number }[], today: string) => {
    const p = paidUntil(open, today, rules.terms);
    return { currentPeriodEnd: p.periodEnd, graceDays: p.graceDays, isTrial: false, manuallySuspended: false, plan: { billingCycle: 'SEASONAL' } };
  };
  const at = (d: string) => new Date(`${d}T09:00:00+03:00`);
  const t1 = { dueDate: '2027-01-15', graceDays: 30 };

  it('unpaid: active to the due date, then 30 days of grace, then read-only', () => {
    expect(effectiveStatus(sub([t1], '2027-01-10'), at('2027-01-15'))).toBe('ACTIVE');
    expect(effectiveStatus(sub([t1], '2027-01-16'), at('2027-02-14'))).toBe('GRACE');
    expect(effectiveStatus(sub([t1], '2027-02-15'), at('2027-02-15'))).toBe('READ_ONLY');
  });

  it('paid: active again at once, until next January', () => {
    const paid = sub([], '2027-02-20');
    expect(paid.currentPeriodEnd.toISOString()).toBe('2028-01-15T20:59:59.000Z');
    expect(effectiveStatus(paid, at('2027-02-20'))).toBe('ACTIVE');
  });

  it('a monthly plan past its grace is still SUSPENDED (unchanged)', () => {
    expect(effectiveStatus({ ...sub([t1], '2027-03-01'), plan: { billingCycle: 'MONTHLY' } }, at('2027-03-01'))).toBe('SUSPENDED');
  });
});

describe('seasonal billing: reminders', () => {
  const i = { dueDate: '2027-01-15', graceDays: 30, reminders: [] as string[] };

  it('7 days before, on the day and 7 days before the account locks, once each', () => {
    expect(reminderFor(i, '2027-01-07')).toBeNull();
    expect(reminderFor(i, '2027-01-08')).toBe('BEFORE_DUE');
    expect(reminderFor({ ...i, reminders: ['BEFORE_DUE'] }, '2027-01-09')).toBeNull();
    expect(reminderFor(i, '2027-01-15')).toBe('DUE');
    expect(reminderFor(i, '2027-02-07')).toBe('BEFORE_LOCK');
    expect(reminderFor(i, '2027-02-20')).toBeNull();
  });

  it('reads like the example', () => {
    expect(reminderText('BEFORE_DUE', { label: 'Term 1', amount: 6000, dueDate: '2027-01-15', graceDays: 30 }, 'Pay by M-Pesa in ZARODA POS under My subscription.')).toBe(
      'ZARODA POS: Your Term 1 instalment of KES 6,000 is due 15 Jan. Pay by M-Pesa in ZARODA POS under My subscription.',
    );
  });
});
