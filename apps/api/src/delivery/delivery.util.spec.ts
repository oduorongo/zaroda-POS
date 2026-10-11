import { deliveryCodeFor, effectiveJobStatus, isActiveJobStatus, mayQuote, summarizeDropoff } from './delivery.util';

const KEY = Buffer.alloc(32, 7);

describe('deliveryCodeFor', () => {
  it('is always 4 digits, and the same for the same job', () => {
    const code = deliveryCodeFor('job-1', KEY);
    expect(code).toMatch(/^\d{4}$/);
    expect(deliveryCodeFor('job-1', KEY)).toBe(code);
  });

  it('differs between jobs and between keys (so it cannot be guessed from another job)', () => {
    const codes = new Set(Array.from({ length: 200 }, (_, i) => deliveryCodeFor(`job-${i}`, KEY)));
    expect(codes.size).toBeGreaterThan(150);
    expect(deliveryCodeFor('job-1', Buffer.alloc(32, 9))).not.toBe(deliveryCodeFor('job-1', KEY));
  });
});

describe('summarizeDropoff', () => {
  it('shows riders only the area - the first two parts of the first line', () => {
    expect(summarizeDropoff('Milimani, Kisumu, house 4 behind the blue gate\nCall on arrival')).toBe('Milimani, Kisumu');
    expect(summarizeDropoff('  Nyalenda  ')).toBe('Nyalenda');
  });

  it('never reveals a long street address in full', () => {
    const long = `${'A'.repeat(100)}, house 4`;
    const result = summarizeDropoff(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toContain('house 4');
  });

  it('copes with nothing at all', () => {
    expect(summarizeDropoff(null)).toBe('Delivery address given');
    expect(summarizeDropoff('')).toBe('Delivery address given');
    expect(summarizeDropoff(' , , ')).toBe('Delivery address given');
  });
});

describe('job status helpers', () => {
  it('counts only open and in-progress jobs as active', () => {
    for (const s of ['OPEN', 'ASSIGNED', 'PICKED_UP'] as const) expect(isActiveJobStatus(s)).toBe(true);
    for (const s of ['DELIVERED', 'CANCELLED', 'EXPIRED'] as const) expect(isActiveJobStatus(s)).toBe(false);
  });

  it('treats an open job past its deadline as expired, without needing it to be saved that way', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(effectiveJobStatus({ status: 'OPEN', quoteDeadline: new Date('2026-10-12T09:59:00Z') }, now)).toBe('EXPIRED');
    expect(effectiveJobStatus({ status: 'OPEN', quoteDeadline: new Date('2026-10-12T10:30:00Z') }, now)).toBe('OPEN');
    expect(effectiveJobStatus({ status: 'ASSIGNED', quoteDeadline: new Date('2026-10-12T09:00:00Z') }, now)).toBe('ASSIGNED');
  });
});

describe('mayQuote', () => {
  const job = { organizationId: 'shop-a', targetRiderId: 'rider-picked' };
  const rider = (over: Record<string, unknown>) => ({ id: 'r', organizationId: null as string | null, status: 'APPROVED', ...over });

  it('never lets a rider who is not approved quote', () => {
    for (const audience of ['EVERYONE', 'SHOP_RIDERS', 'ONE_RIDER'] as const) {
      expect(mayQuote(audience, job, rider({ status: 'PENDING', organizationId: 'shop-a', id: 'rider-picked' }))).toBe(false);
      expect(mayQuote(audience, job, rider({ status: 'SUSPENDED', organizationId: 'shop-a', id: 'rider-picked' }))).toBe(false);
    }
  });

  it('EVERYONE: the business\'s own riders and the shared pool, but never another business\'s own riders', () => {
    expect(mayQuote('EVERYONE', job, rider({ organizationId: 'shop-a' }))).toBe(true);
    expect(mayQuote('EVERYONE', job, rider({ organizationId: null }))).toBe(true);
    expect(mayQuote('EVERYONE', job, rider({ organizationId: 'shop-b' }))).toBe(false);
  });

  it('SHOP_RIDERS: only the business\'s own riders - not the pool', () => {
    expect(mayQuote('SHOP_RIDERS', job, rider({ organizationId: 'shop-a' }))).toBe(true);
    expect(mayQuote('SHOP_RIDERS', job, rider({ organizationId: null }))).toBe(false);
    expect(mayQuote('SHOP_RIDERS', job, rider({ organizationId: 'shop-b' }))).toBe(false);
  });

  it('ONE_RIDER: just the rider the business picked', () => {
    expect(mayQuote('ONE_RIDER', job, rider({ id: 'rider-picked' }))).toBe(true);
    expect(mayQuote('ONE_RIDER', job, rider({ id: 'someone-else' }))).toBe(false);
  });
});
