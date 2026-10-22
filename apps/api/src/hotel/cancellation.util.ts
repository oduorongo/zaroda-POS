// The hotel's cancellation policy as a plain function. All money in whole cents.
//
// A guest who cancels at least `freeDays` days before the arrival date gets everything they paid back. Cancel later (or not turn up)
// and the hotel keeps `keepPercent` of what was paid as the cancellation fee; the rest goes back. A manager can waive the fee.

const DAY_MS = 86_400_000;
const cents = (n: number) => Math.round(n * 100);

export interface CancellationPolicy {
  freeDays: number;
  keepPercent: number;
}

export interface CancellationOutcome {
  /** Whole days from the cancellation day to the arrival day (negative once the arrival day has passed). */
  daysBefore: number;
  withinFreeWindow: boolean;
  paid: number;
  feeKept: number;
  refundDue: number;
  waived: boolean;
}

/** Whole days between two calendar days (both at midnight UTC, as the booking dates are held). */
export const daysBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS);

export function cancellationOutcome(input: {
  paid: number;
  arrival: Date;
  today: Date;
  policy: CancellationPolicy;
  waive?: boolean;
}): CancellationOutcome {
  const daysBefore = daysBetween(input.today, input.arrival);
  const withinFreeWindow = daysBefore >= input.policy.freeDays;
  const paidCents = Math.max(0, cents(input.paid));
  const waived = input.waive === true;
  const keptCents =
    withinFreeWindow || waived
      ? 0
      : Math.min(
          paidCents,
          Math.round((paidCents * input.policy.keepPercent) / 100),
        );
  return {
    daysBefore,
    withinFreeWindow,
    paid: paidCents / 100,
    feeKept: keptCents / 100,
    refundDue: (paidCents - keptCents) / 100,
    waived: waived && !withinFreeWindow,
  };
}
