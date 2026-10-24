import {
  balanceOf,
  noteLine,
  planDelivery,
  statusAfterDelivery,
} from './school-delivery.util';

const line = (id: string, agreed: number, delivered = 0) => ({
  id,
  title: `Item ${id}`,
  agreed,
  delivered,
});

describe('balanceOf', () => {
  it('is what is agreed less what has gone out, never below zero', () => {
    expect(balanceOf({ agreed: 100, delivered: 40 })).toBe(60);
    expect(balanceOf({ agreed: 10, delivered: 10 })).toBe(0);
    expect(balanceOf({ agreed: 10, delivered: 12 })).toBe(0);
  });
  it('copes with fractions without drifting', () => {
    expect(balanceOf({ agreed: 1, delivered: 0.9 })).toBe(0.1);
    expect(balanceOf({ agreed: 0.3, delivered: 0.1 })).toBe(0.2);
  });
});

describe('planDelivery', () => {
  it('takes the whole balance of every line that is not mentioned', () => {
    const p = planDelivery([line('a', 10), line('b', 5, 2)], new Map());
    expect(p.problem).toBeNull();
    expect(p.quantities.get('a')).toBe(10);
    expect(p.quantities.get('b')).toBe(3);
  });
  it('takes the quantity entered for a line, which may be part of the balance (or none)', () => {
    const p = planDelivery(
      [line('a', 10), line('b', 5)],
      new Map([
        ['a', 4],
        ['b', 0],
      ]),
    );
    expect(p.problem).toBeNull();
    expect(p.quantities.get('a')).toBe(4);
    expect(p.quantities.get('b')).toBe(0);
  });
  it('refuses more than is left on a line, saying how much is', () => {
    const p = planDelivery([line('a', 10, 8)], new Map([['a', 5]]));
    expect(p.problem).toContain('only 2 left');
  });
  it('refuses a delivery that carries nothing', () => {
    expect(planDelivery([line('a', 10)], new Map([['a', 0]])).problem).toBe(
      'Nothing to deliver',
    );
    expect(planDelivery([line('a', 10, 10)], new Map()).problem).toBe(
      'Nothing to deliver',
    );
  });
  it('a line the supplier could not supply (agreed 0) never blocks the rest', () => {
    const p = planDelivery([line('a', 0), line('b', 5)], new Map());
    expect(p.problem).toBeNull();
    expect(p.quantities.get('b')).toBe(5);
  });
});

describe('statusAfterDelivery', () => {
  it('is delivered once nothing is left anywhere, otherwise partly delivered', () => {
    expect(statusAfterDelivery([line('a', 10, 10), line('b', 5, 5)])).toBe(
      'DELIVERED',
    );
    expect(statusAfterDelivery([line('a', 10, 10), line('b', 5, 3)])).toBe(
      'PARTIALLY_DELIVERED',
    );
    expect(statusAfterDelivery([line('a', 0, 0), line('b', 5, 5)])).toBe(
      'DELIVERED',
    );
  });
});

describe('noteLine', () => {
  it('shows what was ordered, what went before, what goes now and what is still to come', () => {
    expect(noteLine({ ordered: 100, agreed: 90, before: 30, now: 20 })).toEqual(
      {
        ordered: 100,
        before: 30,
        now: 20,
        balance: 40,
      },
    );
  });
});
