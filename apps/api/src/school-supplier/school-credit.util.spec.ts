import {
  creditableQuantity,
  invoiceBalance,
  invoiceSurplus,
  planCreditNote,
  statusAfterSettlement,
} from './school-credit.util';

const line = (
  id: string,
  quantity: number,
  unitPrice: number,
  taxRate = 0,
  creditedQuantity = 0,
) => ({
  id,
  description: `Item ${id}`,
  quantity,
  unitPrice,
  taxRate,
  creditedQuantity,
});

describe('planCreditNote', () => {
  it('credits part of a line at the invoice price, with its VAT', () => {
    const p = planCreditNote(
      [line('a', 10, 100, 0.16)],
      [{ invoiceLineId: 'a', quantity: 4 }],
      1160,
    );
    expect(p.problem).toBeNull();
    expect(p.subtotal).toBe(400);
    expect(p.taxAmount).toBe(64);
    expect(p.total).toBe(464);
  });

  it('crediting every line in full gives exactly the invoice total', () => {
    const lines = [
      line('a', 80, 45, 0),
      line('b', 50, 20, 0.16),
      line('c', 7, 33.33, 0.16),
    ];
    const invoice =
      lines.reduce(
        (s, l) =>
          s +
          Math.round(l.quantity * l.unitPrice * 100) +
          Math.round(Math.round(l.quantity * l.unitPrice * 100) * l.taxRate),
        0,
      ) / 100;
    const p = planCreditNote(
      lines,
      lines.map((l) => ({ invoiceLineId: l.id, quantity: l.quantity })),
      invoice,
    );
    expect(p.problem).toBeNull();
    expect(p.total).toBe(invoice);
  });

  it('refuses more than is left on a line, counting earlier credit notes', () => {
    const p = planCreditNote(
      [line('a', 10, 100, 0, 7)],
      [{ invoiceLineId: 'a', quantity: 4 }],
      300,
    );
    expect(p.problem).toContain('only 3 left');
  });

  it('refuses goods put back in stock that are more than the quantity credited', () => {
    const p = planCreditNote(
      [line('a', 10, 100)],
      [{ invoiceLineId: 'a', quantity: 2, restock: 3 }],
      1000,
    );
    expect(p.problem).toContain('cannot be more than');
  });

  it('allows a credit with nothing put back (a price correction, goods thrown away)', () => {
    const p = planCreditNote(
      [line('a', 10, 100)],
      [{ invoiceLineId: 'a', quantity: 10 }],
      1000,
    );
    expect(p.problem).toBeNull();
    expect(p.lines[0].restock).toBe(0);
  });

  it('refuses nothing chosen, a line twice, a zero quantity and a line from another invoice', () => {
    const l = [line('a', 10, 100)];
    expect(planCreditNote(l, [], 1000).problem).toContain('at least one');
    expect(
      planCreditNote(
        l,
        [
          { invoiceLineId: 'a', quantity: 1 },
          { invoiceLineId: 'a', quantity: 1 },
        ],
        1000,
      ).problem,
    ).toContain('twice');
    expect(
      planCreditNote(l, [{ invoiceLineId: 'a', quantity: 0 }], 1000).problem,
    ).toContain('how many');
    expect(
      planCreditNote(l, [{ invoiceLineId: 'zzz', quantity: 1 }], 1000).problem,
    ).toContain('not part of this invoice');
  });

  it('never credits more than the invoice still stands at', () => {
    const p = planCreditNote(
      [line('a', 10, 100)],
      [{ invoiceLineId: 'a', quantity: 10 }],
      900,
    );
    expect(p.problem).toContain('more than the invoice still stands at');
  });

  it('trims a cent of rounding rather than refusing a full credit', () => {
    // three lines whose VAT rounds up by a cent each when worked separately but the invoice was a cent lower
    const lines = [
      line('a', 1, 0.05, 0.16),
      line('b', 1, 0.05, 0.16),
      line('c', 1, 0.05, 0.16),
    ];
    const p = planCreditNote(
      lines,
      lines.map((l) => ({ invoiceLineId: l.id, quantity: 1 })),
      0.17,
    );
    expect(p.problem).toBeNull();
    expect(p.total).toBeLessThanOrEqual(0.17);
  });
});

describe('creditableQuantity', () => {
  it('is what the invoice charged less what has been credited', () => {
    expect(creditableQuantity({ quantity: 10, creditedQuantity: 3.5 })).toBe(
      6.5,
    );
    expect(creditableQuantity({ quantity: 10, creditedQuantity: 10 })).toBe(0);
  });
});

describe('statusAfterSettlement', () => {
  it('counts payments and credit notes together', () => {
    expect(statusAfterSettlement(1000, 0, 0)).toBe('ISSUED');
    expect(statusAfterSettlement(1000, 400, 0)).toBe('PARTIALLY_PAID');
    expect(statusAfterSettlement(1000, 0, 300)).toBe('PARTIALLY_PAID');
    expect(statusAfterSettlement(1000, 700, 300)).toBe('PAID');
    expect(statusAfterSettlement(1000, 0, 1000)).toBe('PAID');
    expect(statusAfterSettlement(1000, 1000, 200)).toBe('PAID');
  });
});

describe('invoiceBalance and invoiceSurplus', () => {
  it('what is owed after payments and credits, and what is over', () => {
    expect(invoiceBalance(1000, 400, 100)).toBe(500);
    expect(invoiceBalance(1000, 1000, 200)).toBe(0);
    expect(invoiceSurplus(1000, 1000, 200)).toBe(200);
    expect(invoiceSurplus(1000, 400, 100)).toBe(0);
  });
});
