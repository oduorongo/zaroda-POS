import { checkDelivery, checkDeliveryCounty, distanceKm, inKenya, KENYA_COUNTIES, normalizeCounties, normalizeCounty, servedCounties } from './delivery-area';

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

describe('delivery reach: distance, counties or Kenya', () => {
  // Kondele and Milimani in Kisumu are about 3 km apart; Nairobi is about 265 km from Kisumu.
  const kondele = { lat: -0.0886, lng: 34.7681 };
  const milimani = { lat: -0.1022, lng: 34.7476 };
  const nairobi = { lat: -1.2864, lng: 36.8172 };
  const shop = { name: 'Mama Shop', reach: 'RADIUS', radiusKm: 5, lat: kondele.lat, lng: kondele.lng, served: ['Kisumu'], ownCounty: 'Kisumu' };

  it('measures distance in km', () => {
    expect(distanceKm(kondele, milimani)).toBeGreaterThan(2);
    expect(distanceKm(kondele, milimani)).toBeLessThan(4);
    expect(Math.round(distanceKm(kondele, nairobi))).toBeGreaterThan(250);
  });

  it('a distance shop delivers inside its km, refuses farther away, and needs the shopper location', () => {
    expect(checkDelivery(shop, milimani)).toMatchObject({ ok: true, county: 'Kisumu' });
    expect(checkDelivery(shop, nairobi)).toMatchObject({ ok: false });
    expect(checkDelivery(shop, nairobi).message).toMatch(/within 5 km.*about \d+ km away/);
    expect(checkDelivery(shop, { county: 'Kisumu' }).message).toMatch(/Share your location/);
  });

  it('a distance shop without its pin yet falls back to its counties', () => {
    expect(checkDelivery({ ...shop, lat: null, lng: null }, { county: 'Kisumu' })).toMatchObject({ ok: true });
    expect(checkDelivery({ ...shop, lat: null, lng: null }, { county: 'Nairobi' })).toMatchObject({ ok: false });
  });

  it('a Kenya-wide shop (hardware by vehicle) delivers to any county, and a county shop works as before', () => {
    expect(checkDelivery({ ...shop, reach: 'KENYA' }, { county: 'mombasa' })).toMatchObject({ ok: true, county: 'Mombasa' });
    expect(checkDelivery({ ...shop, reach: 'KENYA' }, {})).toMatchObject({ ok: false });
    expect(checkDelivery({ ...shop, reach: 'COUNTIES' }, { county: 'Nairobi' })).toMatchObject({ ok: false });
  });

  it('knows roughly where Kenya is', () => {
    expect(inKenya(kondele.lat, kondele.lng)).toBe(true);
    expect(inKenya(51.5, -0.12)).toBe(false);
  });
});
