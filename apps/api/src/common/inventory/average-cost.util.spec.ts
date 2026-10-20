import { averageCost } from './average-cost.util';

describe('averageCost', () => {
  it('blends a new delivery into the stock already held, by weight', () => {
    expect(averageCost({ onHand: 10, oldCost: 80, receivedQty: 20, unitCost: 110 })).toBe(100);
    expect(averageCost({ onHand: 30, oldCost: 100, receivedQty: 10, unitCost: 60 })).toBe(90);
  });

  it('becomes the new price when there is nothing in stock to blend with', () => {
    expect(averageCost({ onHand: 0, oldCost: 80, receivedQty: 5, unitCost: 120 })).toBe(120);
    expect(averageCost({ onHand: -3, oldCost: 80, receivedQty: 5, unitCost: 120 })).toBe(120); // oversold: the negative stock has no weight
  });

  it('becomes the new price when the stock held has no known cost', () => {
    expect(averageCost({ onHand: 12, oldCost: null, receivedQty: 8, unitCost: 45 })).toBe(45);
  });

  it('is unchanged when the price paid equals the cost', () => {
    expect(averageCost({ onHand: 7, oldCost: 55, receivedQty: 13, unitCost: 55 })).toBe(55);
  });

  it('works with weights in fractions of a kilo and rounds to whole cents', () => {
    // 2.5 kg at 90 + 1.25 kg at 120 = (225 + 150) / 3.75 = 100
    expect(averageCost({ onHand: 2.5, oldCost: 90, receivedQty: 1.25, unitCost: 120 })).toBe(100);
    // 3 at 10 + 1 at 11 = 10.25
    expect(averageCost({ onHand: 3, oldCost: 10, receivedQty: 1, unitCost: 11 })).toBe(10.25);
    // 1 at 10 + 2 at 10.01 = 10.0066... -> 10.01
    expect(averageCost({ onHand: 1, oldCost: 10, receivedQty: 2, unitCost: 10.01 })).toBe(10.01);
  });

  it('keeps the old cost if nothing was actually received', () => {
    expect(averageCost({ onHand: 4, oldCost: 70, receivedQty: 0, unitCost: 999 })).toBe(70);
  });
});
