import { accessProblem, cleanQuestion, nextWeeklyAt } from './ai.util';

const now = new Date('2026-11-02T10:00:00Z');
const sub = (o: Partial<{ isTrial: boolean; manuallySuspended: boolean; end: string }>) => ({
  currentPeriodEnd: new Date(o.end ?? '2026-12-01T00:00:00Z'),
  graceDays: 7,
  isTrial: o.isTrial ?? false,
  manuallySuspended: o.manuallySuspended ?? false,
});

describe('accessProblem', () => {
  it('lets in a paying business, also during its grace days', () => {
    expect(accessProblem(sub({}), now)).toBeNull();
    expect(accessProblem(sub({ end: '2026-10-30T00:00:00Z' }), now)).toBeNull();
  });
  it('keeps out trials, suspended and unpaid businesses, and those with no plan', () => {
    expect(accessProblem(sub({ isTrial: true }), now)).toContain('paid plan');
    expect(accessProblem(sub({ manuallySuspended: true }), now)).toContain('needs paying');
    expect(accessProblem(sub({ end: '2026-10-01T00:00:00Z' }), now)).toContain('needs paying');
    expect(accessProblem(null, now)).toContain('paid');
  });
});

describe('nextWeeklyAt', () => {
  it('allows one weekly summary every 7 days', () => {
    expect(nextWeeklyAt(null, now)).toBeNull();
    expect(nextWeeklyAt(new Date('2026-10-26T09:00:00Z'), now)).toBeNull();
    expect(nextWeeklyAt(new Date('2026-10-30T10:00:00Z'), now)?.toISOString()).toBe('2026-11-06T10:00:00.000Z');
  });
});

describe('cleanQuestion', () => {
  it('tidies spacing, refuses empty ones and cuts long ones', () => {
    expect(cleanQuestion('  what   sold best? ')).toBe('what sold best?');
    expect(cleanQuestion('hi')).toBeNull();
    expect(cleanQuestion(42)).toBeNull();
    expect(cleanQuestion('x'.repeat(900))!.length).toBe(500);
  });
});
