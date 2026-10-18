import { RecipeMap, availablePortions, stockNeeds } from './dish-stock.util';

// Biryani = 0.2 kg rice + 0.25 kg chicken. Pilau = 0.2 kg rice + 0.1 kg beef. Soda is sold as-is.
const recipes: RecipeMap = new Map([
  ['biryani', [{ ingredientVariantId: 'rice', quantity: 0.2 }, { ingredientVariantId: 'chicken', quantity: 0.25 }]],
  ['pilau', [{ ingredientVariantId: 'rice', quantity: 0.2 }, { ingredientVariantId: 'beef', quantity: 0.1 }]],
]);

describe('stockNeeds', () => {
  it('turns dishes into ingredients and leaves ordinary items alone', () => {
    const needs = stockNeeds([{ variantId: 'biryani', quantity: 2 }, { variantId: 'soda', quantity: 3 }], recipes);
    expect(needs.get('rice')).toBeCloseTo(0.4);
    expect(needs.get('chicken')).toBeCloseTo(0.5);
    expect(needs.get('soda')).toBe(3);
    expect(needs.has('biryani')).toBe(false);
  });

  it('adds up a shared ingredient across different dishes', () => {
    const needs = stockNeeds([{ variantId: 'biryani', quantity: 1 }, { variantId: 'pilau', quantity: 2 }], recipes);
    expect(needs.get('rice')).toBeCloseTo(0.6);
  });
});

describe('availablePortions', () => {
  const none = new Map<string, number>();

  it('a dish is as available as its scarcest ingredient allows', () => {
    // rice for 10 portions, chicken for only 3 (0.75 kg / 0.25)
    const onHand = new Map([['rice', 2], ['chicken', 0.75]]);
    expect(availablePortions(['biryani'], recipes, onHand, none).get('biryani')).toBe(3);
  });

  it('a dish with an ingredient out of stock is not available at all', () => {
    const onHand = new Map([['rice', 5]]); // no chicken record at all
    expect(availablePortions(['biryani'], recipes, onHand, none).get('biryani')).toBe(0);
    expect(availablePortions(['biryani'], recipes, new Map([['rice', 5], ['chicken', 0]]), none).get('biryani')).toBe(0);
  });

  it('does not offer a portion the ingredients cannot fully cover', () => {
    const onHand = new Map([['rice', 0.19], ['chicken', 5]]); // just short of one portion's rice
    expect(availablePortions(['biryani'], recipes, onHand, none).get('biryani')).toBe(0);
  });

  it('subtracts what open orders are already holding, in ingredients', () => {
    const onHand = new Map([['rice', 2], ['chicken', 2]]); // 8 portions of chicken, 10 of rice
    const held = stockNeeds([{ variantId: 'biryani', quantity: 5 }], recipes); // a waiting order for 5 biryani
    expect(availablePortions(['biryani'], recipes, onHand, held).get('biryani')).toBe(3);
  });

  it('a held pilau uses up rice that biryani needs too', () => {
    const onHand = new Map([['rice', 1], ['chicken', 10], ['beef', 10]]); // 5 portions of rice
    const held = stockNeeds([{ variantId: 'pilau', quantity: 4 }], recipes); // 0.8 kg rice held
    expect(availablePortions(['biryani', 'pilau'], recipes, onHand, held).get('biryani')).toBe(1);
    expect(availablePortions(['biryani', 'pilau'], recipes, onHand, held).get('pilau')).toBe(1);
  });

  it('an ordinary item is shelf stock minus holds, never below zero', () => {
    expect(availablePortions(['soda'], recipes, new Map([['soda', 10]]), new Map([['soda', 4]])).get('soda')).toBe(6);
    expect(availablePortions(['soda'], recipes, new Map([['soda', 2]]), new Map([['soda', 4]])).get('soda')).toBe(0);
    expect(availablePortions(['soda'], recipes, none, none).get('soda')).toBe(0);
  });

  it('answers for many variants at once', () => {
    const onHand = new Map([['rice', 1], ['chicken', 1], ['beef', 1], ['soda', 7]]);
    const result = availablePortions(['biryani', 'pilau', 'soda'], recipes, onHand, none);
    expect([...result.entries()]).toEqual([['biryani', 4], ['pilau', 5], ['soda', 7]]);
  });
});
