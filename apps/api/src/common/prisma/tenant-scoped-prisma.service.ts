import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { getTenantStore } from '../tenant/tenant-context';

type TenantTx = Omit<Prisma.TransactionClient, '$transaction'>;

/**
 * Wraps a unit of work in a transaction that first sets the RLS session
 * variable (DESIGN.md §2), so every query issued via `tx` inside `fn` is
 * subject to the Postgres policies in prisma/rls.sql - tenant isolation is
 * enforced by the database, not by remembering to add a WHERE clause.
 *
 * Uses `set_config(..., true)` rather than a raw `SET LOCAL` string so the
 * organization id is bound as a query parameter (Prisma's tagged-template
 * $executeRaw), not string-interpolated into SQL.
 */
@Injectable()
export class TenantScopedPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    const { organizationId } = getTenantStore();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    });
  }
}
