import { aging, overLimit, statement, tillShortfall } from './farm-sales.util';

const e = (date: string, kind: 'DELIVERY' | 'PAYMENT', amount: number) => ({ date, kind, amount });

describe('farm sales', () => {
  it('builds a statement with an opening balance and running balance', () => {
    const s = statement([e('2026-10-28', 'DELIVERY', 3000), e('2026-11-02', 'DELIVERY', 2500), e('2026-11-05', 'PAYMENT', 4000), e('2026-11-10', 'DELIVERY', 1800)], '2026-11-01');
    expect(s.opening).toBe(3000);
    expect(s.lines.map((l) => l.balance)).toEqual([5500, 1500, 3300]);
    expect(s.closing).toBe(3300);
  });

  it('ages what is owed: payments clear the oldest deliveries first', () => {
    const a = aging([e('2026-07-01', 'DELIVERY', 1000), e('2026-09-20', 'DELIVERY', 2000), e('2026-11-20', 'DELIVERY', 500), e('2026-11-21', 'PAYMENT', 1500)], '2026-11-25');
    expect(a).toEqual({ current: 500, d31: 0, d61: 1500, d90: 0, owed: 2000, credit: 0 });
  });

  it('keeps an overpayment as credit', () => {
    expect(aging([e('2026-11-01', 'DELIVERY', 1000), e('2026-11-02', 'PAYMENT', 1200)], '2026-11-25')).toEqual({ current: 0, d31: 0, d61: 0, d90: 0, owed: 0, credit: 200 });
  });

  it('tells when a delivery goes past the credit limit', () => {
    expect(overLimit(45_000, 6000, 50_000)).toBe(true);
    expect(overLimit(44_000, 6000, 50_000)).toBe(false);
    expect(overLimit(1_000_000, 6000, null)).toBe(false);
  });

  it('refuses selling more milk than is fit for sale', () => {
    expect(tillShortfall(12.5, 15)).toBe(2.5);
    expect(tillShortfall(12.5, 12.5)).toBe(0);
  });
});
