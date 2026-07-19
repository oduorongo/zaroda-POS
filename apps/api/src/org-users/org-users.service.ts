import { Injectable } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';

@Injectable()
export class OrgUsersService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /**
   * The cashier picker on a shared terminal (DESIGN.md §9) needs to list
   * "who can PIN in here" without exposing anything sensitive - name, role,
   * and the id pin-login needs, nothing else (no email, no PIN hash).
   */
  findAll() {
    return this.tenantPrisma.run((tx) =>
      tx.orgUser.findMany({
        select: {
          id: true,
          role: true,
          branchId: true,
          user: { select: { fullName: true } },
        },
        orderBy: { user: { fullName: 'asc' } },
      }),
    );
  }
}
