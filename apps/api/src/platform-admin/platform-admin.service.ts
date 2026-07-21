import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Every method here queries across tenants - the one identity in this
 * system allowed to. Deliberately does NOT use TenantScopedPrismaService
 * (there's no single tenant to scope to) or a BYPASSRLS Postgres role
 * (a heavier piece of infrastructure this pilot doesn't need yet). Instead:
 *
 * - Listing organizations themselves relies on organizations' own
 *   pre-auth RLS exception (prisma/rls.sql: "OR NULLIF(current_setting(...),
 *   '') IS NULL" - the same exception login() already depends on to find
 *   which org an email belongs to before a tenant exists). A plain query
 *   with no set_config call ever made in the transaction sees every row.
 * - Anything scoped to one specific tenant's own child tables (branches,
 *   org users) is fetched by briefly setting app.current_tenant to that
 *   org's id for one transaction, then querying normally within it - the
 *   exact same mechanism TenantScopedPrismaService.run() uses, just
 *   looped across N tenants here instead of fixed to one.
 *
 * Documented pilot-scale limit: the loop is N *sequential* round trips
 * for an org-list-with-counts view (deliberately not fired concurrently
 * via Promise.all - this codebase's own load-testing history, see the
 * README, found that firing many concurrent interactive transactions
 * against Neon exhausts the connection pool and produces exactly the
 * P2028 "unable to start a transaction in the given time" this method
 * would otherwise be an easy way to trigger on every page load), not one
 * aggregate query. Fine at this pilot's scale (DESIGN.md's stated
 * target); revisit with a real BYPASSRLS-based read replica or admin
 * role if the platform ever hosts enough tenants for this to matter.
 *
 * Every raw $transaction below passes the same {timeout: 15_000, maxWait:
 * 15_000} override TenantScopedPrismaService.run() and AuthService's own
 * raw transactions use - Prisma's defaults (5s/2s) are already known too
 * short for this project's observed Neon latency (see README's load-test
 * history); omitting the override here isn't a smaller version of that
 * problem, it's the identical bug freshly reintroduced.
 */
const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };

@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrganizations() {
    const organizations = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const results = [];
    for (const org of organizations) {
      const counts = await this.countsForOrg(org.id);
      results.push({ ...org, ...counts });
    }
    return results;
  }

  async getOrganization(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    const counts = await this.countsForOrg(id);
    const branches = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${id}, true)`;
      return tx.branch.findMany({ orderBy: { name: 'asc' } });
    }, TX_OPTIONS);
    const orgUsers = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${id}, true)`;
      return tx.orgUser.findMany({
        select: {
          id: true,
          role: true,
          isActive: true,
          user: { select: { fullName: true, email: true } },
        },
        orderBy: { user: { fullName: 'asc' } },
      });
    }, TX_OPTIONS);

    return { ...org, ...counts, branches, orgUsers };
  }

  private async countsForOrg(organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      const branchCount = await tx.branch.count();
      const orgUserCount = await tx.orgUser.count();
      const saleCount = await tx.sale.count();
      return { branchCount, orgUserCount, saleCount };
    }, TX_OPTIONS);
  }
}
