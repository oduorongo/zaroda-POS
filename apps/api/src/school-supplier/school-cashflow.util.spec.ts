import {
  addMonths,
  buildForecast,
  FlowLine,
  horizonEnd,
  occurrences,
  receiptDate,
  scaled,
  scenarioProblem,
  weekIndex,
} from './school-cashflow.util';

const line = (amount: number, date: string, source = 'INVOICE'): FlowLine => ({
  source,
  ref: `${source}-${date}-${amount}`,
  label: 'x',
  amount,
  date,
});

describe('scenarioProblem', () => {
  it('accepts a share of 0-100 and 0-180 days', () => {
    expect(scenarioProblem({ collectPercent: 80, delayDays: 14 })).toBeNull();
  });
  it('refuses nonsense', () => {
    expect(scenarioProblem({ collectPercent: 120, delayDays: 0 })).toContain('between 0 and 100');
    expect(scenarioProblem({ collectPercent: 50, delayDays: -1 })).toContain('0 to 180');
    expect(scenarioProblem({ collectPercent: 50, delayDays: 2.5 })).toContain('whole number');
  });
});

describe('scaled and receiptDate', () => {
  it('takes a share of an amount to the cent', () => {
    expect(scaled(1000, 80)).toBe(800);
    expect(scaled(33.33, 50)).toBe(16.67);
    expect(scaled(500, 0)).toBe(0);
  });
  it('moves a receipt later by the delay, but never into the past', () => {
    expect(receiptDate('2026-11-10', '2026-11-01', 14)).toBe('2026-11-24');
    expect(receiptDate('2026-10-01', '2026-11-01', 0)).toBe('2026-11-01');
    expect(receiptDate('2026-10-01', '2026-11-01', 14)).toBe('2026-11-01');
  });
});

describe('weekIndex', () => {
  it('counts weeks from today, with anything already due in the first', () => {
    expect(weekIndex('2026-10-01', '2026-11-02')).toBe(0);
    expect(weekIndex('2026-11-02', '2026-11-02')).toBe(0);
    expect(weekIndex('2026-11-08', '2026-11-02')).toBe(0);
    expect(weekIndex('2026-11-09', '2026-11-02')).toBe(1);
  });
  it('is null past the thirteenth week', () => {
    expect(weekIndex(horizonEnd('2026-11-02'), '2026-11-02')).toBe(12);
    expect(weekIndex('2027-02-01', '2026-11-02')).toBeNull();
  });
});

describe('addMonths', () => {
  it('keeps the day of the month, clamped to short months', () => {
    expect(addMonths('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2, 31)).toBe('2026-03-31');
    expect(addMonths('2026-11-15', 3, 15)).toBe('2027-02-15');
  });
});

describe('occurrences', () => {
  const today = '2026-11-02';
  it('a one-off falls once if it is still ahead', () => {
    expect(occurrences({ date: '2026-11-20', repeat: 'NONE', repeatUntil: null }, today, horizonEnd(today))).toEqual(['2026-11-20']);
    expect(occurrences({ date: '2026-10-20', repeat: 'NONE', repeatUntil: null }, today, horizonEnd(today))).toEqual([]);
  });
  it('weekly repeats every seven days until the end, skipping the past', () => {
    const o = occurrences({ date: '2026-10-26', repeat: 'WEEKLY', repeatUntil: null }, today, horizonEnd(today));
    expect(o[0]).toBe('2026-11-02');
    expect(o).toHaveLength(13);
  });
  it('monthly repeats on the same day each month, up to a stop date', () => {
    const o = occurrences({ date: '2026-09-28', repeat: 'MONTHLY', repeatUntil: '2026-12-31' }, today, horizonEnd(today));
    expect(o).toEqual(['2026-11-28', '2026-12-28']);
  });
});

describe('buildForecast', () => {
  const today = '2026-11-02';
  it('adds the weeks up from the opening cash', () => {
    const f = buildForecast({
      today,
      opening: 1000,
      minimum: 0,
      inflows: [line(500, '2026-11-03'), line(300, '2026-11-12')],
      outflows: [line(200, '2026-11-04', 'BILL'), line(900, '2026-11-12', 'PLANNED')],
    });
    expect(f.weeks[0]).toMatchObject({ opening: 1000, inflow: 500, outflow: 200, closing: 1300 });
    expect(f.weeks[1]).toMatchObject({ opening: 1300, inflow: 300, outflow: 900, closing: 700 });
    expect(f.closing).toBe(700);
    expect(f.totalIn).toBe(800);
    expect(f.totalOut).toBe(1100);
  });
  it('puts overdue money in the first week and counts what is beyond 13 weeks separately', () => {
    const f = buildForecast({ today, opening: 0, minimum: 0, inflows: [line(100, '2026-09-01'), line(250, '2027-06-01')], outflows: [line(40, '2027-06-01', 'BILL')] });
    expect(f.weeks[0].inflow).toBe(100);
    expect(f.later).toEqual({ inflow: 250, outflow: 40 });
    expect(f.closing).toBe(100);
  });
  it('finds the lowest point and the first week below the minimum cash', () => {
    const f = buildForecast({
      today,
      opening: 500,
      minimum: 200,
      inflows: [line(1000, '2026-12-10')],
      outflows: [line(400, '2026-11-10', 'PLANNED'), line(400, '2026-11-17', 'PLANNED')],
    });
    expect(f.weeks[1].closing).toBe(100);
    expect(f.firstBelowMinimum).toBe(2);
    expect(f.lowest).toEqual({ week: 3, closing: -300 });
    expect(f.weeks[5].belowMinimum).toBe(false);
  });
  it('is quiet when nothing is expected', () => {
    const f = buildForecast({ today, opening: 100, minimum: 50, inflows: [], outflows: [] });
    expect(f.firstBelowMinimum).toBeNull();
    expect(f.closing).toBe(100);
    expect(f.weeks).toHaveLength(13);
  });
});
