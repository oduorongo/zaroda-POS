import {
  compositionBodies,
  compositionKey,
  compositionProblem,
  customerKey,
  importDecisionProblem,
  normalizeCustPin,
  stampBefore,
} from './etims-extras.util';

describe('normalizeCustPin', () => {
  it('accepts a PIN typed loosely and returns it in capitals', () => {
    expect(normalizeCustPin(' p051234567x ')).toBe('P051234567X');
    expect(normalizeCustPin('A 123456789 Z')).toBe('A123456789Z');
  });
  it('refuses anything else', () => {
    expect(normalizeCustPin('B123456789Z')).toBeNull();
    expect(normalizeCustPin('A12345678Z')).toBeNull();
    expect(normalizeCustPin('')).toBeNull();
    expect(normalizeCustPin(null)).toBeNull();
  });
});

describe('customerKey', () => {
  it('changes when the name or PIN changes, not with spacing or case of the PIN', () => {
    expect(customerKey('Buyer Ltd', 'p051234567x')).toBe(customerKey(' Buyer Ltd ', 'P051234567X'));
    expect(customerKey('Buyer Ltd', 'P051234567X')).not.toBe(customerKey('Buyer Limited', 'P051234567X'));
  });
});

describe('importDecisionProblem', () => {
  const reg = { status: 'REGISTERED', itemCd: 'KE2NTU0000001', itemClsCd: '5059690800' };
  it('approves only an undecided item matched to a product KRA has', () => {
    expect(importDecisionProblem({ decision: 'APPROVE', currentStatus: '2', hasVariant: true, item: reg })).toBeNull();
    expect(importDecisionProblem({ decision: 'APPROVE', currentStatus: '2', hasVariant: false, item: null })).toContain('Choose the product');
    expect(importDecisionProblem({ decision: 'APPROVE', currentStatus: '2', hasVariant: true, item: { ...reg, status: 'NOT_SENT' } })).toContain('not registered');
    expect(importDecisionProblem({ decision: 'APPROVE', currentStatus: '2', hasVariant: true, item: null })).toContain('not registered');
  });
  it('cancels without a product, but never decides twice', () => {
    expect(importDecisionProblem({ decision: 'CANCEL', currentStatus: '2', hasVariant: false, item: null })).toBeNull();
    expect(importDecisionProblem({ decision: 'CANCEL', currentStatus: '3', hasVariant: false, item: null })).toContain('already');
    expect(importDecisionProblem({ decision: 'APPROVE', currentStatus: '4', hasVariant: true, item: reg })).toContain('already');
  });
});

describe('stampBefore', () => {
  it('is one second earlier, across minute, day and year ends', () => {
    expect(stampBefore('20261027101500')).toBe('20261027101459');
    expect(stampBefore('20270101000000')).toBe('20261231235959');
  });
  it('is null for something that is not a stamp', () => {
    expect(stampBefore('')).toBeNull();
    expect(stampBefore('2026-10-27')).toBeNull();
  });
});

describe('recipes (item composition)', () => {
  const creds = { tin: 'P051234567X', bhfId: '00', cmcKey: 'k' };
  it('keys a recipe the same whatever order the ingredients are in', () => {
    expect(compositionKey([{ itemCd: 'KE1A', qty: 0.2 }, { itemCd: 'KE1B', qty: 1 }])).toBe(
      compositionKey([{ itemCd: 'KE1B', qty: 1 }, { itemCd: 'KE1A', qty: 0.2 }]),
    );
    expect(compositionKey([{ itemCd: 'KE1A', qty: 0.2 }])).not.toBe(compositionKey([{ itemCd: 'KE1A', qty: 0.25 }]));
  });
  it('sends one body per ingredient', () => {
    const b = compositionBodies(creds, 'KE2X', [{ itemCd: 'KE1A', qty: 0.2 }, { itemCd: 'KE1B', qty: 1.23456 }], { id: 'ZARODA', name: 'Zaroda POS' });
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ tin: 'P051234567X', itemCd: 'KE2X', cpstItemCd: 'KE1A', cpstQty: 0.2 });
    expect(b[1].cpstQty).toBe(1.235);
  });
  it('waits until the item and every ingredient are registered', () => {
    const reg = { status: 'REGISTERED', itemCd: 'KE2X' };
    expect(compositionProblem(reg, [{ name: 'Rice', itemCd: 'KE1A', status: 'REGISTERED' }])).toBeNull();
    expect(compositionProblem({ status: 'NOT_SENT', itemCd: null }, [])).toContain('item itself');
    expect(compositionProblem(reg, [])).toContain('no ingredients');
    expect(compositionProblem(reg, [{ name: 'Rice', itemCd: null, status: null }])).toContain('Rice');
  });
});
