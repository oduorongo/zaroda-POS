import { checkDeliveryCounty, KENYA_COUNTIES, normalizeCounties, normalizeCounty, servedCounties } from './delivery-area';

describe('counties', () => {
  it('lists all 47 counties, each once', () => {
    expect(KENYA_COUNTIES).toHaveLength(47);
    expect(new Set(KENYA_COUNTIES).size).toBe(47);
  });

  it('recognises however a county is typed', () => {
    expect(normalizeCounty('nairobi')).toBe('Nairobi');
    expect(normalizeCounty('  Nairobi County ')).toBe('Nairobi');
    expect(normalizeCounty('MURANGA')).toBe('Murang\'a');
    expect(normalizeCounty("Murang'a")).toBe("Murang'a");
    expect(normalizeCounty('homabay')).toBe('Homa Bay');
    expect(normalizeCounty('Taita Taveta')).toBe('Taita-Taveta');
    expect(normalizeCounty('Trans-Nzoia')).toBe('Trans Nzoia');
    expect(normalizeCounty('Elgeyo Marakwet')).toBe('Elgeyo-Marakwet');
  });

  it('does not guess at things that are not counties', () => {
    expect(normalizeCounty('Westlands')).toBeNull();
    expect(normalizeCounty('')).toBeNull();
    expect(normalizeCounty(null)).toBeNull();
  });

  it('cleans a typed list and refuses a bad entry', () => {
    expect(normalizeCounties(['migori', 'Migori County', 'kisii'])).toEqual(['Migori', 'Kisii']);
    expect(() => normalizeCounties(['Migori', 'Atlantis'])).toThrow(/Atlantis/);
  });
});

describe('servedCounties', () => {
  it('uses the counties the shop listed', () => {
    expect(servedCounties(['kisii', 'Migori'], 'Nairobi')).toEqual(['Kisii', 'Migori']);
  });

  it("falls back to the branch's own county", () => {
    expect(servedCounties([], 'Nairobi County')).toEqual(['Nairobi']);
  });

  it('is unrestricted (null) only when nothing tells us where the shop is', () => {
    expect(servedCounties([], null)).toBeNull();
    expect(servedCounties([], 'Somewhere nice')).toBeNull();
  });
});

describe('checkDeliveryCounty', () => {
  it('lets a Migori shopper order from a Migori shop', () => {
    expect(checkDeliveryCounty(['Migori'], 'migori', 'Mama Shop')).toEqual({ ok: true, county: 'Migori', message: '' });
  });

  it('stops a Migori shopper ordering delivery from a Nairobi shop', () => {
    const result = checkDeliveryCounty(['Nairobi'], 'Migori', 'Java House');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Java House only delivers in Nairobi');
    expect(result.message).toContain('cannot deliver to Migori');
  });

  it('stops a Kisii shopper ordering from a Mombasa shop', () => {
    expect(checkDeliveryCounty(['Mombasa'], 'Kisii', 'Coast Foods').ok).toBe(false);
  });

  it('names several counties in a readable way', () => {
    const result = checkDeliveryCounty(['Kisii', 'Migori', 'Homa Bay'], 'Nairobi', 'S');
    expect(result.message).toContain('Kisii, Migori and Homa Bay');
  });

  it('needs a county from the shopper when the shop is limited', () => {
    expect(checkDeliveryCounty(['Nairobi'], '', 'S')).toEqual({ ok: false, county: null, message: 'Choose the county we are delivering to' });
    expect(checkDeliveryCounty(['Nairobi'], 'Nowhere', 'S').ok).toBe(false);
  });

  it('does not limit a shop whose area is not known yet', () => {
    expect(checkDeliveryCounty(null, 'Migori', 'S')).toEqual({ ok: true, county: 'Migori', message: '' });
    expect(checkDeliveryCounty(null, undefined, 'S')).toEqual({ ok: true, county: null, message: '' });
  });
});
