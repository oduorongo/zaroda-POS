import { variantTitle } from './variant-title';

describe('variantTitle', () => {
  it('joins the product and the option', () => {
    expect(variantTitle('Bread', 'Large loaf 800g')).toBe('Bread - Large loaf 800g');
  });

  it('is just the product name when the option has no name', () => {
    expect(variantTitle('Soda 500ml', null)).toBe('Soda 500ml');
    expect(variantTitle('Soda 500ml', undefined)).toBe('Soda 500ml');
    expect(variantTitle('Soda 500ml', '   ')).toBe('Soda 500ml');
  });

  it('does not say the product name twice', () => {
    expect(variantTitle('Bread', 'Bread 400g')).toBe('Bread 400g');
    expect(variantTitle('Bread', 'bread, large')).toBe('bread, large');
  });
});
