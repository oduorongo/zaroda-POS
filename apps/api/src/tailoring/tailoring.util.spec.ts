import { handInProblem, materialsCost, materialsFor, pieceCost, tailorBalance } from './tailoring.util';

describe('tailoring maths', () => {
  it('scales the recipe by the number of pieces', () => {
    expect(materialsFor([{ variantId: 'fabric', quantity: 1.2 }, { variantId: 'button', quantity: 7 }], 50)).toEqual([
      { variantId: 'fabric', quantity: 60 },
      { variantId: 'button', quantity: 350 },
    ]);
    expect(materialsFor([{ variantId: 'thread', quantity: 0.333 }], 3)).toEqual([{ variantId: 'thread', quantity: 0.999 }]);
  });

  it('costs the materials and reports lines with no cost', () => {
    expect(materialsCost([{ quantity: 60, unitCost: 250 }, { quantity: 350, unitCost: 2 }, { quantity: 1, unitCost: null }])).toEqual({
      total: 15700,
      uncosted: 1,
    });
  });

  it('a piece costs its share of materials plus the rate', () => {
    expect(pieceCost({ materialsCost: 15700, quantity: 50, ratePerPiece: 80 })).toBe(394);
    expect(pieceCost({ materialsCost: 100, quantity: 3, ratePerPiece: 0 })).toBe(33.33);
  });

  it('refuses hand-ins of nothing or more than the tailor holds', () => {
    const job = { quantity: 50, quantityGood: 30, quantityRejected: 2 };
    expect(handInProblem(job, 0, 0)).toMatch(/how many/);
    expect(handInProblem(job, 17, 2)).toMatch(/Only 18 pieces/);
    expect(handInProblem(job, 16, 2)).toBeNull();
    expect(handInProblem({ quantity: 5, quantityGood: 4, quantityRejected: 0 }, 2, 0)).toMatch(/Only 1 piece is/);
  });

  it('works out what a tailor is owed, ignoring voided payments', () => {
    expect(tailorBalance([{ labourAmount: 2400 }, { labourAmount: 800 }], [{ amount: 2000, voided: false }, { amount: 500, voided: true }])).toEqual({
      earned: 3200,
      paid: 2000,
      owed: 1200,
    });
    expect(tailorBalance([], [{ amount: 1000, voided: false }]).owed).toBe(-1000);
  });
});

import { tailorPaymentDraft, tailorWorkDraft } from '../accounting/ledger-posting.util';

describe('tailoring in the books', () => {
  const sum = (d: { lines: { debitCents?: number; creditCents?: number; debit?: number; credit?: number }[] }, side: 'd' | 'c') =>
    d.lines.reduce((t, l) => t + Number((side === 'd' ? (l.debitCents ?? l.debit) : (l.creditCents ?? l.credit)) ?? 0), 0);

  it('work handed in adds to stock and is owed to the tailor; paying clears it', () => {
    const work = tailorWorkDraft({ date: '2026-11-18', label: 'Akinyi, 30 x Shirt 12 (TJ-2026-0001)', amountCents: 240000 });
    const pay = tailorPaymentDraft({ date: '2026-11-18', tailor: 'Akinyi', amountCents: 240000, method: 'MPESA' });
    expect(sum(work, "d")).toBe(240000);
    expect(sum(work, "c")).toBe(240000);
    expect(sum(pay, "d")).toBe(240000);
    expect(sum(pay, "c")).toBe(240000);
    expect(JSON.stringify(work.lines)).toMatch(/INVENTORY[\s\S]*TAILORS_PAYABLE/);
    expect(JSON.stringify(pay.lines)).toMatch(/TAILORS_PAYABLE[\s\S]*MPESA/);
  });
});
