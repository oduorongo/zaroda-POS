import { rangeFor } from './sales-setup-fees.service';

const rates = [
  { industryType: 'ANY', size: 'SMALL', minKes: 1000, maxKes: 3000 },
  { industryType: 'HOTEL', size: 'SMALL', minKes: 5000, maxKes: 8000 },
];

describe('rangeFor', () => {
  it("uses the business type's own range, else the ANY range", () => {
    expect(rangeFor(rates, 'HOTEL', 'SMALL')).toMatchObject({ minKes: 5000, maxKes: 8000 });
    expect(rangeFor(rates, 'RETAIL', 'SMALL')).toMatchObject({ minKes: 1000, maxKes: 3000 });
  });

  it('has no range for a size nobody priced', () => {
    expect(rangeFor(rates, 'RETAIL', 'LARGE')).toBeNull();
  });
});
