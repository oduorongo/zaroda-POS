import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { getTenantStore } from '../tenant/tenant-context';

export type TenantTx = Omit<Prisma.TransactionClient, '$transaction'>;

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
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
        return fn(tx);
      },
      {
        // Prisma's default interactive-transaction timeout is 5s, which a
        // multi-step unit of work (e.g. SalesService.create: several
        // lookups, line items, an inventory ledger write per line, an
        // audit log entry) can exceed over a remote connection's
        // round-trip latency - raised rather than trimming the
        // transaction's work, since correctness (everything committing/
        // rolling back together) matters more here than shaving
        // milliseconds off a POS sale.
        timeout: 15_000,
        // maxWait is a DIFFERENT setting from timeout above - it bounds
        // how long a caller waits to even acquire a pool connection
        // before the transaction starts, not how long the transaction
        // itself may run. Prisma's default is 2s, which a Phase 3 load
        // test caught being far too tight: with DATABASE_URL's
        // connection_limit=10, any burst of concurrent writes beyond 10
        // (a busy multi-terminal branch at rush hour, or exactly the
        // scenario a load test is supposed to simulate) has requests
        // queue for a free connection, and 2s isn't enough queue time
        // once several already-running transactions are each taking a
        // second or more. The load test's requests were failing with
        // "Unable to start a transaction in the given time" - literally
        // this timeout's error message - even though every already-
        // running transaction was completing fine within the 15s above.
        maxWait: 15_000,
      },
    );
  }
}
