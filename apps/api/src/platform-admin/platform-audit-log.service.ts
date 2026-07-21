import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export interface PlatformAuditLogEntry {
  platformAdminId: string;
  action: string;
  entityType: string;
  entityId?: string;
  organizationId?: string;
}

/**
 * A platform admin can see across every tenant - a materially more
 * sensitive capability than anything an OrgUser has (see schema.prisma's
 * comment on PlatformAuditLog), so every action gets logged here,
 * including plain reads (list/view an organization) - unlike the
 * tenant-scoped AuditLogService, which only logs writes. Called directly
 * (not inside a tx the way AuditLogService.logInTx is) since there's no
 * single tenant-scoped transaction most of these actions naturally sit
 * inside - a platform admin viewing an org's counts already spans several
 * of its own short-lived transactions (PlatformAdminService.countsForOrg
 * et al.), so there's no one unit of work to log atomically with anyway.
 */
@Injectable()
export class PlatformAuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  log(entry: PlatformAuditLogEntry) {
    return this.prisma.platformAuditLog.create({ data: entry });
  }
}
