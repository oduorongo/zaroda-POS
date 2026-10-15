import { NotFoundException } from '@nestjs/common';
import { tenantContext } from '../common/tenant/tenant-context';
import { assertInScope, assertLeaseInScope, caretakerPropertyIds, propertyFilter } from './rental-caretaker-scope';

const asRole = <T>(role: 'CARETAKER' | 'MANAGER', fn: () => Promise<T>) => tenantContext.run({ organizationId: 'org-1', orgUserId: 'ou-1', role }, fn);
const txWith = (propertyIds: string[], leaseProperty?: string) =>
  ({
    rentalCaretakerProperty: { findMany: jest.fn(async () => propertyIds.map((propertyId) => ({ propertyId }))) },
    rentalLease: { findUnique: jest.fn(async () => (leaseProperty ? { unit: { propertyId: leaseProperty } } : null)) },
  }) as never;

describe('caretaker property scope', () => {
  it('does not limit a manager', async () => {
    expect(await asRole('MANAGER', () => caretakerPropertyIds(txWith([])))).toBeNull();
  });

  it('limits a caretaker to the properties assigned to them, and to nothing when none are assigned', async () => {
    expect(await asRole('CARETAKER', () => caretakerPropertyIds(txWith(['p1', 'p2'])))).toEqual(['p1', 'p2']);
    expect(await asRole('CARETAKER', () => caretakerPropertyIds(txWith([])))).toEqual([]);
  });

  it('narrows a requested property filter to what the caretaker may see', () => {
    expect(propertyFilter(null, 'p9')).toBe('p9');
    expect(propertyFilter(null)).toBeUndefined();
    expect(propertyFilter(['p1', 'p2'])).toEqual({ in: ['p1', 'p2'] });
    expect(propertyFilter(['p1', 'p2'], 'p2')).toBe('p2');
    expect(propertyFilter(['p1', 'p2'], 'p9')).toEqual({ in: [] });
  });

  it('answers "not found" for a record in someone else\'s property, and lets owners through', () => {
    expect(() => assertInScope(['p1'], 'p2', 'Property')).toThrow(NotFoundException);
    expect(() => assertInScope(['p1'], 'p1', 'Property')).not.toThrow();
    expect(() => assertInScope(null, 'p2', 'Property')).not.toThrow();
  });

  it('refuses a payment on a lease in another town but allows one in the caretaker\'s own property', async () => {
    await expect(asRole('CARETAKER', () => assertLeaseInScope(txWith(['p1'], 'p2'), 'lease-1'))).rejects.toThrow(NotFoundException);
    await expect(asRole('CARETAKER', () => assertLeaseInScope(txWith(['p1'], 'p1'), 'lease-1'))).resolves.toBeUndefined();
    await expect(asRole('MANAGER', () => assertLeaseInScope(txWith([], 'p2'), 'lease-1'))).resolves.toBeUndefined();
  });
});
