import { Injectable } from '@nestjs/common';
import { TenantTx } from '../prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../tenant/tenant-context';

export interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  terminalId?: string;
}

/**
 * Every price override, void, discount, and refund must be traceable to a
 * user and timestamp (DESIGN.md §3). Deliberately takes an already-open
 * `tx` rather than opening its own transaction (unlike
 * TenantScopedPrismaService.run() callers elsewhere) - an audit entry must
 * commit or roll back atomically with the action it's recording, never
 * separately. Called from inside the same tenant-scoped transaction as
 * whatever it's auditing.
 */
@Injectable()
export class AuditLogService {
  async logInTx(tx: TenantTx, entry: AuditLogEntry) {
    const { organizationId, orgUserId } = getTenantStore();
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: orgUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before:
          entry.before === undefined ? undefined : (entry.before as object),
        after: entry.after === undefined ? undefined : (entry.after as object),
        terminalId: entry.terminalId,
      },
    });
  }
}
