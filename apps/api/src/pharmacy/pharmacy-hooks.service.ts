import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';

interface InventoryBeforeDecrementPayload {
  branchId: string;
  variantId: string;
  quantityDelta: number;
  type: string;
  batchId?: string;
}

@Injectable()
export class PharmacyHooksService {
  private readonly logger = new Logger(PharmacyHooksService.name);

  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /**
   * Fires for every decrement system-wide (core has no concept of
   * "pharmacy"), the same way the restaurant module's hooks do - this is
   * what makes it a no-op for the vast majority of decrements that carry
   * no batchId at all, and for non-pharmacy tenants that do track
   * batches (e.g. perishable retail) but haven't opted into having
   * expired stock blocked outright rather than just flagged.
   *
   * Deliberately scoped to PHARMACY-industryType organizations only, not
   * "any org with an expired batch": a retail tenant selling near-expiry
   * cosmetics at a discount is a legitimate business call this module
   * has no business overriding - DESIGN.md frames this specifically as
   * pharmacy policy layered on top of core's generic batch/expiry data,
   * not a universal rule core itself should enforce.
   *
   * Throws (aborting the whole sale transaction, same veto mechanism
   * proven in Phase 4's restaurant hooks) rather than just logging -
   * dispensing an expired medication is exactly the kind of mistake this
   * hook exists to make structurally impossible, not merely flagged
   * after the fact.
   */
  async onInventoryBeforeDecrement(payload: unknown): Promise<void> {
    const { batchId } = payload as InventoryBeforeDecrementPayload;
    if (!batchId) return;

    const { organizationId } = getTenantStore();

    await this.tenantPrisma.run(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: organizationId },
      });
      if (org?.industryType !== 'PHARMACY') return;

      const batch = await tx.batch.findUnique({ where: { id: batchId } });
      if (!batch?.expiryDate) return;

      if (batch.expiryDate.getTime() < Date.now()) {
        this.logger.warn(
          `Blocked decrement from expired batch ${batch.id} (expired ${batch.expiryDate.toISOString()})`,
        );
        throw new BadRequestException(
          `Batch ${batch.batchNumber} expired on ${batch.expiryDate.toISOString().slice(0, 10)} and cannot be sold`,
        );
      }
    });
  }
}
