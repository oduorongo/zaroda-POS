import { boxBalance, topUpNeeded, withBalance } from './petty-cash.util';

describe('petty cash maths', () => {
  const moves = [
    { kind: 'TOP_UP' as const, amount: 5000, voided: false },
    { kind: 'PAYMENT' as const, amount: 350, voided: false },
    { kind: 'PAYMENT' as const, amount: 1200, voided: true },
    { kind: 'PAYMENT' as const, amount: 99.5, voided: false },
    { kind: 'COUNT' as const, amount: -50.5, voided: false },
  ];

  it('the balance is top-ups less payments, with count differences, ignoring voided entries', () => {
    expect(boxBalance(moves)).toBe(4500);
  });

  it('a top-up brings the box back to its float, never below zero', () => {
    expect(topUpNeeded(5000, 4500)).toBe(500);
    expect(topUpNeeded(5000, 5200)).toBe(0);
  });

  it('the petty cash book runs a balance, showing voided lines at no effect', () => {
    const book = withBalance(0, moves);
    expect(book.map((l) => l.balance)).toEqual([5000, 4650, 4650, 4550.5, 4500]);
    expect(book[1]).toMatchObject({ moneyIn: 0, moneyOut: 350 });
    expect(book[2]).toMatchObject({ moneyIn: 0, moneyOut: 0 });
    expect(book[4]).toMatchObject({ moneyOut: 50.5 });
  });
});
