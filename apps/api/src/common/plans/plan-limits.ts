import { ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '../prisma/tenant-scoped-prisma.service';

// Terminals the system makes for itself (online orders, hotel desk, school credit, construction certificates): never tills.
const SYSTEM_TERMINALS = ['Online shop', 'Front desk', 'School credit sales', 'Construction certificates'];

/**
 * Refuses a new till or branch beyond the business's plan (Basic 1 till, the free Online Shop only plan none...).
 * A business with no device plan (rentals, construction) is not limited here. What already exists keeps working.
 */
export async function assertPlanAllows(tx: TenantTx, organizationId: string, what: 'TERMINAL' | 'BRANCH'): Promise<void> {
  const sub = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  if (!sub) return;
  const { plan } = sub;
  if (what === 'TERMINAL') {
    const used = await tx.terminal.count({ where: { branch: { organizationId }, deviceLabel: { notIn: SYSTEM_TERMINALS } } });
    if (used >= plan.maxDevices) {
      throw new ForbiddenException(
        plan.maxDevices === 0
          ? `The ${plan.name} plan has no tills. Ask ZARODA to move you to a paid plan to sell in-store with ZARODA.`
          : `Your ${plan.name} plan allows ${plan.maxDevices} till${plan.maxDevices === 1 ? '' : 's'}. Ask ZARODA to move you to a bigger plan to add more.`,
      );
    }
    return;
  }
  const used = await tx.branch.count({ where: { organizationId } });
  if (used >= plan.maxBranches) {
    throw new ForbiddenException(`Your ${plan.name} plan allows ${plan.maxBranches} branch${plan.maxBranches === 1 ? '' : 'es'}. Ask ZARODA to move you to a bigger plan to add more.`);
  }
}
