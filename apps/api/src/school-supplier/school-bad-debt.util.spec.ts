import {
  approvalCheck,
  bandFor,
  DEFAULT_RATES,
  needsApproval,
  provisionFor,
  ratesProblem,
  writeOffProblem,
} from './school-bad-debt.util';

describe('bandFor', () => {
  it('is nothing until the due date has passed', () => {
    expect(bandFor(0)).toBeNull();
    expect(bandFor(-5)).toBeNull();
  });
  it('splits at the edges of each band', () => {
    expect(bandFor(1)).toBe('D1_30');
    expect(bandFor(30)).toBe('D1_30');
    expect(bandFor(31)).toBe('D31_60');
    expect(bandFor(60)).toBe('D31_60');
    expect(bandFor(61)).toBe('D61_90');
    expect(bandFor(90)).toBe('D61_90');
    expect(bandFor(91)).toBe('D91_180');
    expect(bandFor(180)).toBe('D91_180');
    expect(bandFor(181)).toBe('D181_PLUS');
  });
});

describe('ratesProblem', () => {
  it('accepts the defaults', () => {
    expect(ratesProblem(DEFAULT_RATES)).toBeNull();
  });
  it('refuses a rate outside 0-100', () => {
    expect(ratesProblem({ ...DEFAULT_RATES, D181_PLUS: 120 })).toContain('between 0 and 100');
    expect(ratesProblem({ ...DEFAULT_RATES, D1_30: -1 })).toContain('between 0 and 100');
  });
  it('refuses an older debt at a lower rate than a newer one', () => {
    expect(ratesProblem({ ...DEFAULT_RATES, D61_90: 3 })).toContain('cannot be lower');
  });
});

describe('provisionFor', () => {
  it('sets aside the rate of each band and ignores what is not late', () => {
    const p = provisionFor(
      [
        { amount: 1000, daysOverdue: 0 },
        { amount: 1000, daysOverdue: 10 },
        { amount: 2000, daysOverdue: 45 },
        { amount: 4000, daysOverdue: 200 },
      ],
      DEFAULT_RATES,
    );
    expect(p.overdue).toBe(7000);
    expect(p.byBand.find((b) => b.band === 'D1_30')).toMatchObject({ amount: 1000, provision: 10 });
    expect(p.byBand.find((b) => b.band === 'D31_60')).toMatchObject({ amount: 2000, provision: 100 });
    expect(p.byBand.find((b) => b.band === 'D181_PLUS')).toMatchObject({ amount: 4000, provision: 4000 });
    expect(p.total).toBe(4110);
  });
  it('is nothing with nothing overdue', () => {
    expect(provisionFor([], DEFAULT_RATES)).toMatchObject({ overdue: 0, total: 0 });
  });
  it('rounds to the cent', () => {
    expect(provisionFor([{ amount: 33.33, daysOverdue: 45 }], DEFAULT_RATES).total).toBe(1.67);
  });
});

describe('writeOffProblem', () => {
  it('must be something and no more than is owed', () => {
    expect(writeOffProblem(0, 100)).toContain('how much');
    expect(writeOffProblem(150, 100)).toContain('Only 100.00');
    expect(writeOffProblem(100, 100)).toBeNull();
  });
});

describe('needsApproval', () => {
  it('applies from the threshold up, and to everything when it is 0', () => {
    expect(needsApproval(49999.99, 50000)).toBe(false);
    expect(needsApproval(50000, 50000)).toBe(true);
    expect(needsApproval(1, 0)).toBe(true);
  });
});

describe('approvalCheck', () => {
  it('lets someone other than the requester approve', () => {
    expect(approvalCheck({ requesterId: 'a', approverId: 'b', approverIsOwner: false })).toEqual({ ok: true, overridden: false });
  });
  it('does not let a manager approve their own', () => {
    expect(approvalCheck({ requesterId: 'a', approverId: 'a', approverIsOwner: false })).toMatchObject({ ok: false });
  });
  it('lets an owner approve their own only with a reason, and flags it', () => {
    expect(approvalCheck({ requesterId: 'a', approverId: 'a', approverIsOwner: true })).toMatchObject({ ok: false });
    expect(approvalCheck({ requesterId: 'a', approverId: 'a', approverIsOwner: true, overrideReason: 'ok' })).toMatchObject({ ok: false });
    expect(approvalCheck({ requesterId: 'a', approverId: 'a', approverIsOwner: true, overrideReason: 'Sole owner, school closed' })).toEqual({ ok: true, overridden: true });
  });
});
