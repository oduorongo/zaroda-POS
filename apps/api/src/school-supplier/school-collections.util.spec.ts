import {
  chaseOrder,
  daysLate,
  followUpProblem,
  promiseBroken,
} from './school-collections.util';

describe('daysLate', () => {
  it('counts the days past the due date and is zero before it', () => {
    expect(daysLate('2026-10-01', '2026-10-11')).toBe(10);
    expect(daysLate('2026-10-11', '2026-10-11')).toBe(0);
    expect(daysLate('2026-10-20', '2026-10-11')).toBe(0);
  });
});

describe('promiseBroken', () => {
  it('is only broken once the promised day has gone by', () => {
    expect(promiseBroken('2026-10-10', '2026-10-11')).toBe(true);
    expect(promiseBroken('2026-10-11', '2026-10-11')).toBe(false);
    expect(promiseBroken(null, '2026-10-11')).toBe(false);
  });
});

describe('followUpProblem', () => {
  it('a dispute must say what it is about', () => {
    expect(followUpProblem({ disputed: true }, '2026-10-01')).toContain(
      'dispute',
    );
    expect(
      followUpProblem({ disputed: true, disputeNote: 'ab' }, '2026-10-01'),
    ).toContain('dispute');
    expect(
      followUpProblem(
        { disputed: true, disputeNote: 'Books damaged' },
        '2026-10-01',
      ),
    ).toBeNull();
  });
  it('a promise to pay cannot be dated before the invoice', () => {
    expect(
      followUpProblem({ expectedPaymentDate: '2026-09-30' }, '2026-10-01'),
    ).toContain('before the invoice');
    expect(
      followUpProblem({ expectedPaymentDate: '2026-10-15' }, '2026-10-01'),
    ).toBeNull();
  });
  it('a note alone is always fine', () => {
    expect(
      followUpProblem({ note: 'Called the bursar' }, '2026-10-01'),
    ).toBeNull();
  });
});

describe('chaseOrder', () => {
  it('chases the longest overdue first, undisputed before disputed, then the bigger balance', () => {
    const rows = [
      { id: 'a', daysLate: 10, disputed: false, balance: 100 },
      { id: 'b', daysLate: 40, disputed: true, balance: 900 },
      { id: 'c', daysLate: 40, disputed: false, balance: 50 },
      { id: 'd', daysLate: 10, disputed: false, balance: 500 },
    ];
    expect(chaseOrder(rows).map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});
