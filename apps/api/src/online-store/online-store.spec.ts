import { normalizeSlug } from './online-store.constants';
import { publishBlockers } from './online-store.service';

describe('normalizeSlug', () => {
  it.each([
    ['mama-mboga', 'mama-mboga'],
    ['  Mama-Mboga ', 'mama-mboga'],
    ['shop254', 'shop254'],
    ['abc', 'abc'],
  ])('accepts %p', (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });

  it.each(['ab', '-abc', 'abc-', 'a--b', 'has space', 'émoji', 'a'.repeat(41), 'admin', 'checkout'])(
    'rejects %p',
    (input) => {
      expect(normalizeSlug(input)).toBeNull();
    },
  );
});

describe('publishBlockers', () => {
  const ready = {
    slug: 'mama-mboga',
    displayName: 'Mama Mboga',
    fulfilmentBranchId: 'branch-1',
    pickupEnabled: true,
    deliveryEnabled: false,
    tumaApiKeyEncrypted: 'v1:...',
  };

  it('is empty when everything is set', () => {
    expect(publishBlockers(ready)).toEqual([]);
  });

  it('lists each missing piece', () => {
    expect(
      publishBlockers({
        slug: null,
        displayName: null,
        fulfilmentBranchId: null,
        pickupEnabled: false,
        deliveryEnabled: false,
        tumaApiKeyEncrypted: null,
      }),
    ).toHaveLength(5);
  });

  it('requires TUMA to be connected', () => {
    expect(publishBlockers({ ...ready, tumaApiKeyEncrypted: null })).toEqual([
      'Connect your TUMA account so buyers can pay you',
    ]);
  });
});
