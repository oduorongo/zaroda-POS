import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getTenantStore } from '../common/tenant/tenant-context';

type Tx = Prisma.TransactionClient;

/**
 * A caretaker only works on the properties the landlord assigned to them; owners and managers are never limited.
 * `null` means "no limit" (not a caretaker). A caretaker with nothing assigned gets an empty list, so sees nothing.
 * Every rental read and write a caretaker can reach goes through one of these helpers.
 */
export async function caretakerPropertyIds(tx: Tx): Promise<string[] | null> {
  const { role, orgUserId } = getTenantStore();
  if (role !== 'CARETAKER') return null;
  const rows = await tx.rentalCaretakerProperty.findMany({ where: { orgUserId }, select: { propertyId: true } });
  return rows.map((r) => r.propertyId);
}

/** A Prisma filter for a propertyId column: the caller's own request, narrowed to what a caretaker may see. */
export function propertyFilter(scope: string[] | null, requested?: string): string | { in: string[] } | undefined {
  if (!scope) return requested;
  if (requested) return scope.includes(requested) ? requested : { in: [] };
  return { in: scope };
}

/** "Not found", never "not allowed": a caretaker should not learn that another property's record exists. */
export function assertInScope(scope: string[] | null, propertyId: string, what: string): void {
  if (scope && !scope.includes(propertyId)) throw new NotFoundException(`${what} not found`);
}

export async function assertLeaseInScope(tx: Tx, leaseId: string): Promise<void> {
  const scope = await caretakerPropertyIds(tx);
  if (!scope) return;
  const lease = await tx.rentalLease.findUnique({ where: { id: leaseId }, select: { unit: { select: { propertyId: true } } } });
  if (lease) assertInScope(scope, lease.unit.propertyId, 'Lease');
}
