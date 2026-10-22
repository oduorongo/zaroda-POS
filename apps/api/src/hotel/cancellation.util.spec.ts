import { cancellationOutcome, daysBetween } from './cancellation.util';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const policy = { freeDays: 2, keepPercent: 100 };

describe('daysBetween', () => {
  it('counts calendar days', () => {
    expect(daysBetween(day('2026-11-01'), day('2026-11-04'))).toBe(3);
    expect(daysBetween(day('2026-11-04'), day('2026-11-04'))).toBe(0);
    expect(daysBetween(day('2026-11-05'), day('2026-11-04'))).toBe(-1);
  });
});

describe('cancellationOutcome', () => {
  const run = (over: Partial<Parameters<typeof cancellationOutcome>[0]> = {}) =>
    cancellationOutcome({
      paid: 3000,
      arrival: day('2026-11-10'),
      today: day('2026-11-01'),
      policy,
      ...over,
    });

  it('cancelled well before arrival: everything paid goes back', () => {
    expect(run()).toMatchObject({
      withinFreeWindow: true,
      feeKept: 0,
      refundDue: 3000,
      daysBefore: 9,
    });
  });
  it('exactly the free number of days before is still free', () => {
    expect(run({ today: day('2026-11-08') })).toMatchObject({
      withinFreeWindow: true,
      refundDue: 3000,
    });
  });
  it('one day too late and the hotel keeps its percentage of the deposit', () => {
    expect(run({ today: day('2026-11-09') })).toMatchObject({
      withinFreeWindow: false,
      feeKept: 3000,
      refundDue: 0,
    });
    expect(
      run({
        today: day('2026-11-09'),
        policy: { freeDays: 2, keepPercent: 50 },
      }),
    ).toMatchObject({ feeKept: 1500, refundDue: 1500 });
  });
  it('on the arrival day or after (a no-show) the fee applies', () => {
    expect(run({ today: day('2026-11-10') })).toMatchObject({
      withinFreeWindow: false,
      feeKept: 3000,
    });
    expect(
      run({
        today: day('2026-11-12'),
        policy: { freeDays: 2, keepPercent: 25 },
      }),
    ).toMatchObject({ feeKept: 750, refundDue: 2250, daysBefore: -2 });
  });
  it('a manager can waive the fee', () => {
    expect(run({ today: day('2026-11-09'), waive: true })).toMatchObject({
      feeKept: 0,
      refundDue: 3000,
      waived: true,
    });
  });
  it('waiving a fee that was never due is not reported as a waiver', () => {
    expect(run({ waive: true }).waived).toBe(false);
  });
  it('keeps the fee and the refund adding up to exactly what was paid, odd cents included', () => {
    const o = run({
      paid: 1000.01,
      today: day('2026-11-09'),
      policy: { freeDays: 2, keepPercent: 33 },
    });
    expect(Math.round((o.feeKept + o.refundDue) * 100)).toBe(100001);
    expect(o.feeKept).toBe(330);
  });
  it('a booking with nothing paid owes nothing back and keeps nothing', () => {
    expect(run({ paid: 0, today: day('2026-11-09') })).toMatchObject({
      feeKept: 0,
      refundDue: 0,
    });
  });
  it('a zero free window means only arrival day or later is charged', () => {
    expect(
      run({
        today: day('2026-11-10'),
        policy: { freeDays: 0, keepPercent: 100 },
      }),
    ).toMatchObject({ withinFreeWindow: true, refundDue: 3000 });
    expect(
      run({
        today: day('2026-11-11'),
        policy: { freeDays: 0, keepPercent: 100 },
      }),
    ).toMatchObject({ withinFreeWindow: false, feeKept: 3000 });
  });
});
