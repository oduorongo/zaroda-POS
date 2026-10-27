import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalKind, Prisma } from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { nairobiDayOf } from '../reports/profit.util';
import { AccountKey, SYSTEM_ACCOUNTS } from './ledger-chart';
import { DraftLine, isBalanced, tidy } from './ledger-posting.util';

export const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const todayKey = () => nairobiDayOf(new Date());

export interface EntryInput {
  date: string;
  kind: JournalKind;
  memo: string;
  sourceType?: string | null;
  sourceId?: string | null;
  branchId?: string | null;
  reversesId?: string | null;
  /** Lines on system accounts (by key) or on any account (by id). */
  lines: (DraftLine | { accountId: string; debit: number; credit: number; memo?: string | null })[];
  by?: { id: string | null; name: string | null };
}

/**
 * The books themselves: the settings row and chart of accounts (made the first time they are needed), entry numbers, and writing a
 * balanced entry. Everything here runs inside the caller's tenant transaction.
 */
@Injectable()
export class LedgerBooksService {
  /** Only one writer per business at a time, so entry numbers never collide and a source is never posted twice. */
  async lock(tx: TenantTx) {
    const { organizationId } = getTenantStore();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ledger:' + organizationId}))`;
  }

  /** The settings, made on first use: the books start today unless the business chooses an earlier day. */
  async settings(tx: TenantTx) {
    const { organizationId } = getTenantStore();
    const found = await tx.ledgerSettings.findUnique({ where: { organizationId } });
    if (found) return found;
    await tx.ledgerSettings.createMany({ data: [{ organizationId, startDate: dateOf(todayKey()) }], skipDuplicates: true });
    await this.ensureChart(tx);
    return tx.ledgerSettings.findUniqueOrThrow({ where: { organizationId } });
  }

  /** Adds any system account the business does not have yet (a code already used by one of its own accounts gets a suffix). */
  async ensureChart(tx: TenantTx) {
    const { organizationId } = getTenantStore();
    const have = await tx.ledgerAccount.findMany({ select: { code: true, systemKey: true } });
    const keys = new Set(have.map((a) => a.systemKey));
    const codes = new Set(have.map((a) => a.code));
    const missing = SYSTEM_ACCOUNTS.filter((a) => !keys.has(a.key));
    if (missing.length === 0) return;
    await tx.ledgerAccount.createMany({
      data: missing.map((a) => {
        let code: string = a.code;
        for (let i = 1; codes.has(code); i++) code = `${a.code}-${i}`;
        codes.add(code);
        return { organizationId, code, name: a.name, type: a.type, systemKey: a.key };
      }),
      skipDuplicates: true,
    });
  }

  async accountIds(tx: TenantTx): Promise<Map<string, string>> {
    await this.ensureChart(tx);
    const rows = await tx.ledgerAccount.findMany({ where: { systemKey: { not: null } }, select: { id: true, systemKey: true } });
    return new Map(rows.map((r) => [r.systemKey!, r.id]));
  }

  /** Writes one entry. The caller holds the lock. Refuses an entry that does not balance or falls in a closed period. */
  async write(tx: TenantTx, input: EntryInput, ids?: Map<string, string>) {
    const { organizationId } = getTenantStore();
    const settings = await this.settings(tx);
    const lock = dayOf(settings.lockDate);
    if (lock && input.date <= lock) throw new BadRequestException(`The books are closed up to ${lock}. Choose a later date.`);
    const map = ids ?? (await this.accountIds(tx));
    const lines = input.lines.map((l) => {
      if ('accountId' in l) return { accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo ?? null };
      const accountId = map.get(l.account as AccountKey);
      if (!accountId) throw new Error(`No ledger account for ${l.account}`);
      return { accountId, debit: l.debit, credit: l.credit, memo: null };
    });
    if (!isBalanced(lines.map((l) => ({ account: 'CASH', debit: l.debit, credit: l.credit }))))
      throw new BadRequestException('This entry does not balance.');
    const last = await tx.journalEntry.aggregate({ _max: { number: true } });
    const entry = await tx.journalEntry.create({
      data: {
        organizationId,
        number: (last._max.number ?? 0) + 1,
        entryDate: dateOf(input.date),
        kind: input.kind,
        memo: input.memo.slice(0, 300),
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        branchId: input.branchId ?? null,
        reversesId: input.reversesId ?? null,
        createdById: input.by?.id ?? null,
        createdByName: input.by?.name ?? null,
        lines: {
          create: lines.map((l) => ({
            organizationId,
            accountId: l.accountId,
            debit: new Prisma.Decimal(l.debit).div(100),
            credit: new Prisma.Decimal(l.credit).div(100),
            memo: l.memo,
          })),
        },
      },
    });
    return entry;
  }

  /** An entry that undoes another, on the given day (or the first open day after a closed period). */
  async reverse(tx: TenantTx, entryId: string, date: string, memo: string, by?: EntryInput['by']) {
    const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: true, reversedBy: true } });
    if (original.reversedBy) return original.reversedBy;
    return this.write(tx, {
      date,
      kind: JournalKind.REVERSAL,
      memo,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      branchId: original.branchId,
      reversesId: original.id,
      lines: original.lines.map((l) => ({
        accountId: l.accountId,
        debit: Math.round(Number(l.credit) * 100),
        credit: Math.round(Number(l.debit) * 100),
        memo: l.memo,
      })),
      by,
    });
  }

  /** The lines of a stored entry as drafts on system keys (for a bounce or a void that must undo exactly what was posted). */
  async linesOf(tx: TenantTx, entryId: string): Promise<DraftLine[]> {
    const lines = await tx.journalLine.findMany({ where: { entryId }, include: { account: { select: { systemKey: true } } } });
    return tidy(
      lines
        .filter((l) => l.account.systemKey)
        .map((l) => ({ account: l.account.systemKey as AccountKey, debit: Math.round(Number(l.debit) * 100), credit: Math.round(Number(l.credit) * 100) })),
    );
  }
}
