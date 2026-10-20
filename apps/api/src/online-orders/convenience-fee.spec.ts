import { convenienceFeeFor, totalWithFee } from './convenience-fee';

describe('convenienceFeeFor', () => {
  it('is 3% rounded to the nearest shilling', () => {
    expect(convenienceFeeFor(1000, 0.03)).toBe(30);
    expect(convenienceFeeFor(850, 0.03)).toBe(26); // 25.5 -> 26
    expect(convenienceFeeFor(840, 0.03)).toBe(25); // 25.2 -> 25
    expect(convenienceFeeFor(100, 0.03)).toBe(3);
  });

  it('rounds small carts to the nearest shilling too, possibly to nothing', () => {
    expect(convenienceFeeFor(20, 0.03)).toBe(1); // 0.6
    expect(convenienceFeeFor(10, 0.03)).toBe(0); // 0.3
  });

  it('is nothing for an empty cart or a zero rate (a shop Zaroda has exempted)', () => {
    expect(convenienceFeeFor(0, 0.03)).toBe(0);
    expect(convenienceFeeFor(500, 0)).toBe(0);
    expect(convenienceFeeFor(500, -1)).toBe(0);
  });
});

describe('totalWithFee', () => {
  it('adds the fee to the items, which are rounded up to a whole shilling', () => {
    expect(totalWithFee(1000, 0.03)).toEqual({ fee: 30, amountDue: 1030 });
    expect(totalWithFee(499.5, 0.03)).toEqual({ fee: 15, amountDue: 515 }); // 14.985 -> 15; items 500
  });

  it('charges no fee when the rate is zero', () => {
    expect(totalWithFee(250.4, 0)).toEqual({ fee: 0, amountDue: 251 });
  });
});
