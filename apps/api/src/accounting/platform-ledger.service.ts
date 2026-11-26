import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JournalKind, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { nairobiDayOf } from '../reports/profit.util';
import { CreateAccountDto, CreateJournalDto, JournalListQueryDto, RangeQueryDto, ReverseJournalDto, UpdateAccountDto } from './dto/accounting.dto';
import { dateOf, dayOf, todayKey } from './ledger-books.service';
import { PLATFORM_ACCOUNTS } from './ledger-chart';
import { CON_PAYMENT_INCOME, CON_PAYMENT_LABEL } from './construction-posting.util';
import { Draft, DraftLine, fingerprint, isBalanced, manualProblem, postingDate } from './ledger-posting.util';
import { CountDto, PlatformPettyPayDto, TopUpDto, VoidEntryDto } from '../petty-cash/dto/petty-cash.dto';
import { boxBalance, topUpNeeded, withBalance } from '../petty-cash/petty-cash.util';
import { AccountInfo, balanceSheetWithTithe, profitWithTithe, Sums, trialBalance, withRunningBalance } from './ledger-reports.util';
import {
  platformConPaymentDraft,
  platformAppIncomeDraft, platformSchoolPaymentDraft,
  platformAdvertDraft,
  platformInvoiceDraft,
  platformInvoiceIncome,
  platformInvoicePaidDraft,
  platformPayoutDraft,
  platformSubscriptionDraft,
} from './platform-posting.util';

type Tx = Prisma.TransactionClient;
const TX = { timeout: 30_000, maxWait: 15_000 };
const PAGE = 50;
const money = (cents: number) => Math.round(cents) / 100;
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const NAIROBI_OFFSET_MS = 3 * 3600_000;

export const PLATFORM_SOURCE_LABELS: Record<string, string> = {
  P_SUBSCRIPTION: 'Subscription paid',
  P_PETTY_CASH: 'Petty cash',
  P_COMMISSION_INVOICE: 'Commission / convenience-fee invoice',
  P_COMMISSION_PAID: 'Commission / convenience-fee invoice paid',
  P_RENTAL_INVOICE: 'Rental plan invoice',
  P_RENTAL_PAID: 'Rental plan invoice paid',
  P_ADVERT: 'House advert fee',
  P_PAYOUT: 'Sales agent paid',
  P_SCHOOL_PAYMENT: 'Zaroda School subscription',
  P_APP_INCOME: 'Income from Zaroda School, Books, Sports or Events',
};

interface Ctx {
  since: Date;
  sinceDay: string;
  lock: string | null;
}

/**
 * A kind of thing posted to ZARODA's books. Most of it lives in tables each business can see only its own rows of, so it is
 * read business by business (with that business set), and written to ZARODA's books with no business set.
 */
interface PSource {
  type: string;
  /** Per business (read with that business set), or once across the platform. */
  perBusiness: boolean;
  /** Everything that should stand in the books since the start, and what should no longer (e.g. waived). */
  scan: (tx: Tx, c: Ctx) => Promise<{ fresh: string[]; gone: string[] }>;
  draft: (tx: Tx, id: string, business: string) => Promise<Draft | null>;
}

/** ZARODA's own double-entry books, kept by the platform admin. */
@Injectable()
export class PlatformLedgerService {
  private readonly logger = new Logger(PlatformLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A transaction with no business set: the only way ZARODA's books can be read or written. */
  private platform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, TX);
  }

  private asBusiness<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX);
  }

  private async lock(tx: Tx) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ledger:platform'))`;
  }

  // ── the books ───────────────────────────────────────────────────────────

  private async settings(tx: Tx) {
    const found = await tx.platformLedgerSettings.findUnique({ where: { id: 'default' } });
    if (found) return found;
    await tx.platformLedgerSettings.createMany({ data: [{ id: 'default', startDate: dateOf(todayKey()) }], skipDuplicates: true });
    await this.ensureChart(tx);
    return tx.platformLedgerSettings.findUniqueOrThrow({ where: { id: 'default' } });
  }

  private async ensureChart(tx: Tx) {
    const have = await tx.platformLedgerAccount.findMany({ select: { code: true, systemKey: true } });
    const keys = new Set(have.map((a) => a.systemKey));
    const codes = new Set(have.map((a) => a.code));
    const missing = PLATFORM_ACCOUNTS.filter((a) => !keys.has(a.key));
    if (missing.length === 0) return;
    await tx.platformLedgerAccount.createMany({
      data: missing.map((a) => {
        let code: string = a.code;
        for (let i = 1; codes.has(code); i++) code = `${a.code}-${i}`;
        codes.add(code);
        return { code, name: a.name, type: a.type, systemKey: a.key };
      }),
      skipDuplicates: true,
    });
  }

  private async accountIds(tx: Tx) {
    await this.ensureChart(tx);
    const rows = await tx.platformLedgerAccount.findMany({ where: { systemKey: { not: null } }, select: { id: true, systemKey: true } });
    return new Map(rows.map((r) => [r.systemKey!, r.id]));
  }

  private async write(
    tx: Tx,
    input: {
      date: string;
      kind: JournalKind;
      memo: string;
      sourceType?: string | null;
      sourceId?: string | null;
      organizationId?: string | null;
      reversesId?: string | null;
      lines: (DraftLine | { accountId: string; debit: number; credit: number; memo?: string | null })[];
      by?: { id: string | null; name: string | null };
    },
  ) {
    const s = await this.settings(tx);
    const lock = dayOf(s.lockDate);
    if (lock && input.date <= lock) throw new BadRequestException(`The books are closed up to ${lock}. Choose a later date.`);
    const map = await this.accountIds(tx);
    const lines = input.lines.map((l) => {
      if ('accountId' in l) return { accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo ?? null };
      const accountId = map.get(l.account);
      if (!accountId) throw new Error(`No platform ledger account for ${l.account}`);
      return { accountId, debit: l.debit, credit: l.credit, memo: null };
    });
    if (!isBalanced(lines.map((l) => ({ account: '', debit: l.debit, credit: l.credit })))) throw new BadRequestException('This entry does not balance.');
    const last = await tx.platformJournalEntry.aggregate({ _max: { number: true } });
    return tx.platformJournalEntry.create({
      data: {
        number: (last._max.number ?? 0) + 1,
        entryDate: dateOf(input.date),
        kind: input.kind,
        memo: input.memo.slice(0, 300),
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        organizationId: input.organizationId ?? null,
        reversesId: input.reversesId ?? null,
        createdById: input.by?.id ?? null,
        createdByName: input.by?.name ?? null,
        lines: {
          create: lines.map((l) => ({ accountId: l.accountId, debit: new Prisma.Decimal(l.debit).div(100), credit: new Prisma.Decimal(l.credit).div(100), memo: l.memo })),
        },
      },
    });
  }

  private async reverse(tx: Tx, entryId: string, date: string, memo: string, by?: { id: string | null; name: string | null }) {
    const original = await tx.platformJournalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: true, reversedBy: true } });
    if (original.reversedBy) return original.reversedBy;
    return this.write(tx, {
      date,
      kind: JournalKind.REVERSAL,
      memo,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      organizationId: original.organizationId,
      reversesId: original.id,
      lines: original.lines.map((l) => ({ accountId: l.accountId, debit: cents(l.credit), credit: cents(l.debit), memo: l.memo })),
      by,
    });
  }

  // ── posting ─────────────────────────────────────────────────────────────

  private readonly sources: PSource[] = [
    {
      type: 'P_SUBSCRIPTION',
      perBusiness: true,
      scan: async (tx, c) => ({
        fresh: (await tx.subscriptionPayment.findMany({ where: { paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id, business) => {
        const p = await tx.subscriptionPayment.findUnique({ where: { id } });
        return p ? platformSubscriptionDraft({ date: nairobiDayOf(p.paidAt), business, amountCents: cents(p.amount), method: p.method }) : null;
      },
    },
    {
      type: 'P_COMMISSION_INVOICE',
      perBusiness: true,
      scan: async (tx, c) => {
        const rows = await tx.commissionInvoice.findMany({ where: { issuedAt: { gte: c.since } }, select: { id: true, status: true } });
        return { fresh: rows.filter((r) => r.status !== 'WAIVED').map((r) => r.id), gone: rows.filter((r) => r.status === 'WAIVED').map((r) => r.id) };
      },
      draft: async (tx, id, business) => {
        const i = await tx.commissionInvoice.findUnique({ where: { id } });
        if (!i || i.status === 'WAIVED') return null;
        return platformInvoiceDraft({
          date: nairobiDayOf(i.issuedAt),
          reference: i.invoiceNumber,
          business,
          amountCents: i.amountDue > 0 ? i.amountDue * 100 : cents(i.commissionTotal),
          income: platformInvoiceIncome('COMMISSION', i.kind),
        });
      },
    },
    {
      type: 'P_COMMISSION_PAID',
      perBusiness: true,
      scan: async (tx, c) => ({
        fresh: (await tx.commissionInvoice.findMany({ where: { status: 'PAID', paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id, business) => {
        const i = await tx.commissionInvoice.findUnique({ where: { id } });
        if (!i || i.status !== 'PAID' || !i.paidAt) return null;
        return platformInvoicePaidDraft({ date: nairobiDayOf(i.paidAt), reference: i.invoiceNumber, business, amountCents: i.amountDue > 0 ? i.amountDue * 100 : cents(i.commissionTotal), method: i.paymentMethod });
      },
    },
    {
      type: 'P_RENTAL_INVOICE',
      perBusiness: true,
      scan: async (tx, c) => {
        const rows = await tx.rentalPlatformInvoice.findMany({ where: { issuedAt: { gte: c.since } }, select: { id: true, status: true } });
        return { fresh: rows.filter((r) => r.status !== 'WAIVED').map((r) => r.id), gone: rows.filter((r) => r.status === 'WAIVED').map((r) => r.id) };
      },
      draft: async (tx, id, business) => {
        const i = await tx.rentalPlatformInvoice.findUnique({ where: { id } });
        if (!i || i.status === 'WAIVED') return null;
        return platformInvoiceDraft({ date: nairobiDayOf(i.issuedAt), reference: i.invoiceNumber, business, amountCents: i.amountDue * 100, income: platformInvoiceIncome('RENTAL', i.kind) });
      },
    },
    {
      type: 'P_RENTAL_PAID',
      perBusiness: true,
      scan: async (tx, c) => ({
        fresh: (await tx.rentalPlatformInvoice.findMany({ where: { status: 'PAID', paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id, business) => {
        const i = await tx.rentalPlatformInvoice.findUnique({ where: { id } });
        if (!i || i.status !== 'PAID' || !i.paidAt) return null;
        return platformInvoicePaidDraft({ date: nairobiDayOf(i.paidAt), reference: i.invoiceNumber, business, amountCents: i.amountDue * 100, method: i.paymentMethod });
      },
    },
    {
      type: 'P_ADVERT',
      perBusiness: true,
      scan: async (tx, c) => ({
        fresh: (await tx.rentalListingPayment.findMany({ where: { status: 'PAID', paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id, business) => {
        const p = await tx.rentalListingPayment.findUnique({ where: { id } });
        if (!p || p.status !== 'PAID' || !p.paidAt) return null;
        return platformAdvertDraft({ date: nairobiDayOf(p.paidAt), business, amountCents: p.amount * 100 });
      },
    },
    {
      type: 'P_PAYOUT',
      perBusiness: false,
      scan: async (tx, c) => ({
        fresh: (await tx.salesPayout.findMany({ where: { status: 'PAID', paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id) => {
        const p = await tx.salesPayout.findUnique({ where: { id }, include: { agent: { select: { fullName: true } } } });
        if (!p || p.status !== 'PAID' || !p.paidAt) return null;
        return platformPayoutDraft({ date: nairobiDayOf(p.paidAt), agent: p.agent.fullName, amountCents: cents(p.amountKes), taxCents: cents(p.taxWithheldKes), method: p.method });
      },
    },
    {
      type: 'P_CON_PAYMENT',
      perBusiness: true,
      scan: async (tx, c) => ({
        fresh: (await tx.conSubscriptionPayment.findMany({ where: { status: 'PAID', paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id, business) => {
        const p = await tx.conSubscriptionPayment.findUnique({ where: { id } });
        if (!p || p.status !== 'PAID' || !p.paidAt) return null;
        return platformConPaymentDraft({ date: nairobiDayOf(p.paidAt), business, label: CON_PAYMENT_LABEL[p.purpose], income: CON_PAYMENT_INCOME[p.purpose], amountCents: cents(p.amount), method: p.method });
      },
    },
    {
      type: 'P_FARM_PAYMENT',
      perBusiness: true,
      scan: async (tx, c) => ({
        fresh: (await tx.farmSubscriptionPayment.findMany({ where: { status: 'PAID', paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id, business) => {
        const p = await tx.farmSubscriptionPayment.findUnique({ where: { id } });
        if (!p || p.status !== 'PAID' || !p.paidAt) return null;
        const label = p.purpose === 'PLAN' ? `Shamba plan ${p.planCode} (${p.cycle.toLowerCase()})` : p.purpose === 'SMS' ? 'Shamba SMS bundle' : 'Shamba wage payout fees';
        const income = p.purpose === 'PLAN' ? 'SHAMBA_PLAN_INCOME' : p.purpose === 'SMS' ? 'SMS_INCOME' : 'PAYOUT_FEE_INCOME';
        return platformConPaymentDraft({ date: nairobiDayOf(p.paidAt), business, label, income, amountCents: cents(p.amount), method: p.method });
      },
    },
    {
      type: 'P_SCHOOL_PAYMENT',
      perBusiness: false,
      scan: async (tx, c) => ({
        fresh: (await tx.schoolSubscriptionReceipt.findMany({ where: { paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id) => {
        const r = await tx.schoolSubscriptionReceipt.findUnique({ where: { id } });
        return r ? platformSchoolPaymentDraft({ date: nairobiDayOf(r.paidAt), school: r.schoolName, amountCents: cents(r.amountKes), reference: r.reference }) : null;
      },
    },
    {
      type: 'P_APP_INCOME',
      perBusiness: false,
      scan: async (tx, c) => ({
        fresh: (await tx.appIncomeReceipt.findMany({ where: { paidAt: { gte: c.since } }, select: { id: true } })).map((r) => r.id),
        gone: [],
      }),
      draft: async (tx, id) => {
        const r = await tx.appIncomeReceipt.findUnique({ where: { id } });
        return r
          ? platformAppIncomeDraft({ date: nairobiDayOf(r.paidAt), app: r.app, payer: r.payer, description: r.description, amountCents: cents(r.amountKes), reference: r.reference })
          : null;
      },
    },
  ];

  /** Writes one source's posting in ZARODA's books, reversing what stood before if it changed. */
  private async apply(type: string, id: string, organizationId: string | null, draft: Draft | null, c: Ctx) {
    const wanted = draft && draft.lines.length > 0 ? draft : null;
    const fp = fingerprint(wanted);
    return this.platform(async (tx) => {
      await this.lock(tx);
      const key = { sourceType_sourceId: { sourceType: type, sourceId: id } };
      const existing = await tx.platformLedgerPosting.findUnique({ where: key });
      if (existing && existing.fingerprint === fp) return 'same' as const;
      if (existing?.entryId) {
        const old = await tx.platformJournalEntry.findUniqueOrThrow({ where: { id: existing.entryId } });
        await this.reverse(tx, old.id, postingDate(dayOf(old.entryDate)!, c.lock), `Undo: ${old.memo}`);
      }
      let entryId: string | null = null;
      if (wanted) {
        const e = await this.write(tx, { date: postingDate(wanted.date, c.lock), kind: JournalKind.AUTO, memo: wanted.memo, sourceType: type, sourceId: id, organizationId, lines: wanted.lines });
        entryId = e.id;
      }
      await tx.platformLedgerPosting.upsert({ where: key, create: { sourceType: type, sourceId: id, fingerprint: fp, entryId }, update: { fingerprint: fp, entryId } });
      if (!existing) return 'posted' as const;
      return wanted ? ('reposted' as const) : ('reversed' as const);
    });
  }

  /** One pass over everything ZARODA charged and paid. Never posts the same thing twice; a waived invoice is reversed. */
  async runPass() {
    const result = { posted: 0, reposted: 0, reversed: 0, failed: 0 };
    let lastError: string | null = null;
    const c = await this.platform(async (tx) => {
      const s = await this.settings(tx);
      const sinceDay = dayOf(s.startDate)!;
      return { since: new Date(new Date(`${sinceDay}T00:00:00.000Z`).getTime() - NAIROBI_OFFSET_MS), sinceDay, lock: dayOf(s.lockDate) } satisfies Ctx;
    });
    const orgs = await this.prisma.organization.findMany({ select: { id: true, name: true } });
    const scopes: { organizationId: string | null; name: string }[] = [...orgs.map((o) => ({ organizationId: o.id, name: o.name })), { organizationId: null, name: 'ZARODA' }];
    for (const scope of scopes) {
      const read = <T>(fn: (tx: Tx) => Promise<T>) => (scope.organizationId ? this.asBusiness(scope.organizationId, fn) : this.platform(fn));
      for (const source of this.sources.filter((s) => s.perBusiness === !!scope.organizationId)) {
        try {
          const { fresh, gone } = await read((tx) => source.scan(tx, c));
          if (fresh.length + gone.length === 0) continue;
          const posted = await this.platform((tx) =>
            tx.platformLedgerPosting.findMany({ where: { sourceType: source.type, sourceId: { in: [...fresh, ...gone] } }, select: { sourceId: true, entryId: true } }),
          );
          const done = new Map(posted.map((p) => [p.sourceId, p.entryId]));
          const todo = [...fresh.filter((id) => !done.has(id)), ...gone.filter((id) => done.get(id))];
          for (const id of todo) {
            try {
              const draft = await read((tx) => source.draft(tx, id, scope.name));
              const r = await this.apply(source.type, id, scope.organizationId, draft, c);
              if (r !== 'same') result[r]++;
            } catch (e) {
              result.failed++;
              lastError = `${source.type} ${id.slice(0, 8)}: ${(e as Error).message}`;
              this.logger.warn({ err: e, source: source.type, id }, 'Posting to ZARODA books failed');
            }
          }
        } catch (e) {
          result.failed++;
          lastError = `${source.type}: ${(e as Error).message}`;
          this.logger.warn({ err: e, source: source.type, organizationId: scope.organizationId }, 'Reading for ZARODA books failed');
        }
      }
    }
    await this.platform((tx) =>
      tx.platformLedgerSettings.update({
        where: { id: 'default' },
        data: { lastPassAt: new Date(), ...(result.failed > 0 ? { lastPassNote: lastError?.slice(0, 500) } : result.posted + result.reposted + result.reversed > 0 ? { lastPassNote: null } : {}) },
      }),
    );
    return result;
  }

  // ── screens ─────────────────────────────────────────────────────────────

  async overview() {
    return this.platform(async (tx) => {
      const s = await this.settings(tx);
      return {
        startDate: dayOf(s.startDate),
        lockDate: dayOf(s.lockDate),
        titheRate: Number(s.titheRate),
        pettyCashFloat: Number(s.pettyCashFloat),
        lastPassAt: s.lastPassAt,
        lastPassNote: s.lastPassNote,
        entries: await tx.platformJournalEntry.count(),
        accounts: await tx.platformLedgerAccount.count(),
      };
    });
  }

  async updateSettings(dto: { startDate?: string; lockDate?: string | null; titheRate?: number; pettyCashFloat?: number }) {
    await this.platform(async (tx) => {
      await this.lock(tx);
      const s = await this.settings(tx);
      const data: Prisma.PlatformLedgerSettingsUpdateInput = {};
      if (dto.startDate !== undefined && dto.startDate !== dayOf(s.startDate)) {
        if (dto.startDate > todayKey()) throw new BadRequestException('The books cannot start in the future.');
        if ((await tx.platformLedgerPosting.count()) > 0 && dto.startDate > dayOf(s.startDate)!)
          throw new ConflictException('Things have already been posted from the current start date, so it can only be moved earlier.');
        data.startDate = dateOf(dto.startDate);
      }
      if (dto.lockDate !== undefined) {
        if (dto.lockDate && dto.lockDate >= todayKey()) throw new BadRequestException('The books can only be closed up to yesterday.');
        data.lockDate = dto.lockDate ? dateOf(dto.lockDate) : null;
      }
      if (dto.titheRate !== undefined) data.titheRate = dto.titheRate;
      if (dto.pettyCashFloat !== undefined) data.pettyCashFloat = dto.pettyCashFloat;
      await tx.platformLedgerSettings.update({ where: { id: 'default' }, data });
    });
    return this.overview();
  }

  private async sums(tx: Tx, r: { from?: string; to?: string; before?: string }): Promise<Sums> {
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (r.from) conds.push(Prisma.sql`e."entryDate" >= ${r.from}::date`);
    if (r.to) conds.push(Prisma.sql`e."entryDate" <= ${r.to}::date`);
    if (r.before) conds.push(Prisma.sql`e."entryDate" < ${r.before}::date`);
    const rows = await tx.$queryRaw<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>(
      Prisma.sql`SELECT l."accountId", SUM(l.debit) AS debit, SUM(l.credit) AS credit FROM platform_journal_lines l JOIN platform_journal_entries e ON e.id = l."entryId" WHERE ${Prisma.join(conds, ' AND ')} GROUP BY l."accountId"`,
    );
    return new Map(rows.map((x) => [x.accountId, { debit: cents(x.debit), credit: cents(x.credit) }]));
  }

  private async accountInfo(tx: Tx): Promise<AccountInfo[]> {
    await this.settings(tx);
    return tx.platformLedgerAccount.findMany({ select: { id: true, code: true, name: true, type: true, systemKey: true } });
  }

  async accounts() {
    return this.platform(async (tx) => {
      await this.settings(tx);
      await this.ensureChart(tx);
      const [list, sums] = await Promise.all([tx.platformLedgerAccount.findMany(), this.sums(tx, {})]);
      return list
        .map((a) => {
          const s = sums.get(a.id) ?? { debit: 0, credit: 0 };
          return { ...a, balance: money(a.type === 'ASSET' || a.type === 'EXPENSE' ? s.debit - s.credit : s.credit - s.debit), system: !!a.systemKey };
        })
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    });
  }

  async createAccount(dto: CreateAccountDto) {
    return this.platform(async (tx) => {
      await this.settings(tx);
      if (await tx.platformLedgerAccount.findFirst({ where: { code: dto.code } })) throw new ConflictException(`Account code ${dto.code} is already used.`);
      return tx.platformLedgerAccount.create({ data: { code: dto.code, name: dto.name.trim(), type: dto.type, description: dto.description?.trim() || null } });
    });
  }

  async updateAccount(id: string, dto: UpdateAccountDto) {
    return this.platform(async (tx) => {
      const a = await tx.platformLedgerAccount.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('Account not found');
      if (a.systemKey && dto.type && dto.type !== a.type) throw new BadRequestException('The kind of this account is fixed because the system posts to it.');
      if (a.systemKey && dto.active === false) throw new BadRequestException('This account is used by automatic postings, so it cannot be switched off.');
      if (dto.type && dto.type !== a.type && (await tx.platformJournalLine.count({ where: { accountId: id } })) > 0)
        throw new BadRequestException('This account already has entries, so its kind cannot change.');
      if (dto.code && dto.code !== a.code && (await tx.platformLedgerAccount.findFirst({ where: { code: dto.code } }))) throw new ConflictException(`Account code ${dto.code} is already used.`);
      return tx.platformLedgerAccount.update({
        where: { id },
        data: { code: dto.code, name: dto.name?.trim(), type: dto.type, description: dto.description === undefined ? undefined : dto.description.trim() || null, active: dto.active },
      });
    });
  }

  async journals(q: JournalListQueryDto) {
    const page = q.page ?? 1;
    return this.platform(async (tx) => {
      const where: Prisma.PlatformJournalEntryWhereInput = {
        kind: q.kind,
        sourceType: q.sourceType,
        sourceId: q.sourceId,
        entryDate: q.from || q.to ? { gte: q.from ? dateOf(q.from) : undefined, lte: q.to ? dateOf(q.to) : undefined } : undefined,
        memo: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
      };
      const [total, rows] = await Promise.all([
        tx.platformJournalEntry.count({ where }),
        tx.platformJournalEntry.findMany({
          where,
          orderBy: [{ entryDate: 'desc' }, { number: 'desc' }],
          skip: (page - 1) * PAGE,
          take: PAGE,
          include: { lines: { select: { debit: true, credit: true, account: { select: { code: true, name: true } } } }, reversedBy: { select: { id: true, number: true } } },
        }),
      ]);
      return {
        total,
        page,
        pageSize: PAGE,
        rows: rows.map((e) => ({
          id: e.id,
          number: e.number,
          date: dayOf(e.entryDate),
          kind: e.kind,
          memo: e.memo,
          source: e.sourceType ? (PLATFORM_SOURCE_LABELS[e.sourceType] ?? e.sourceType) : null,
          amount: money(e.lines.reduce((s, l) => s + cents(l.debit), 0)),
          lines: e.lines.map((l) => ({ code: l.account.code, name: l.account.name, debit: Number(l.debit), credit: Number(l.credit) })).sort((a, b) => (b.debit > 0 ? 1 : 0) - (a.debit > 0 ? 1 : 0) || a.code.localeCompare(b.code, undefined, { numeric: true })),
          reversedBy: e.reversedBy,
          reverses: e.reversesId,
        })),
      };
    });
  }

  async journal(id: string) {
    return this.platform(async (tx) => {
      const e = await tx.platformJournalEntry.findUnique({
        where: { id },
        include: { lines: { include: { account: { select: { code: true, name: true } } } }, reversedBy: { select: { id: true, number: true } }, reverses: { select: { id: true, number: true } } },
      });
      if (!e) throw new NotFoundException('Journal not found');
      return {
        id: e.id,
        number: e.number,
        date: dayOf(e.entryDate),
        kind: e.kind,
        memo: e.memo,
        sourceType: e.sourceType,
        source: e.sourceType ? (PLATFORM_SOURCE_LABELS[e.sourceType] ?? e.sourceType) : null,
        sourceId: e.sourceId,
        organizationId: e.organizationId,
        createdByName: e.createdByName,
        createdAt: e.createdAt,
        reversedBy: e.reversedBy,
        reverses: e.reverses,
        lines: e.lines
          .map((l) => ({ accountId: l.accountId, code: l.account.code, name: l.account.name, debit: Number(l.debit), credit: Number(l.credit), memo: l.memo }))
          .sort((a, b) => (b.debit > 0 ? 1 : 0) - (a.debit > 0 ? 1 : 0) || a.code.localeCompare(b.code, undefined, { numeric: true })),
      };
    });
  }

  async createJournal(dto: CreateJournalDto, by: { id: string; name: string | null }) {
    const lines = dto.lines.map((l) => ({ accountId: l.accountId, debit: cents(l.debit), credit: cents(l.credit), memo: l.memo?.trim() || null }));
    const problem = manualProblem(lines);
    if (problem) throw new BadRequestException(problem);
    if (dto.date > todayKey()) throw new BadRequestException('A journal cannot be dated in the future.');
    const id = await this.platform(async (tx) => {
      await this.lock(tx);
      const accounts = await tx.platformLedgerAccount.findMany({ where: { id: { in: lines.map((l) => l.accountId) } } });
      if (accounts.length !== new Set(lines.map((l) => l.accountId)).size) throw new BadRequestException('One of the accounts was not found.');
      const off = accounts.find((a) => !a.active);
      if (off) throw new BadRequestException(`Account ${off.code} ${off.name} is switched off.`);
      return (await this.write(tx, { date: dto.date, kind: dto.kind === 'OPENING' ? JournalKind.OPENING : JournalKind.MANUAL, memo: dto.memo.trim(), lines, by })).id;
    });
    return this.journal(id);
  }

  async reverseJournal(id: string, dto: ReverseJournalDto, by: { id: string; name: string | null }) {
    const newId = await this.platform(async (tx) => {
      await this.lock(tx);
      const e = await tx.platformJournalEntry.findUnique({ where: { id }, include: { reversedBy: true } });
      if (!e) throw new NotFoundException('Journal not found');
      if (e.kind === JournalKind.AUTO || (e.kind === JournalKind.REVERSAL && e.sourceType))
        throw new BadRequestException('This entry was posted automatically. Correct or waive the invoice or payment it came from and the books follow.');
      if (e.kind === JournalKind.REVERSAL) throw new BadRequestException('This entry is itself a reversal.');
      if (e.reversedBy) throw new ConflictException(`This journal was already reversed by journal ${e.reversedBy.number}.`);
      const s = await this.settings(tx);
      const date = dto.date ?? postingDate(todayKey(), dayOf(s.lockDate));
      if (date > todayKey()) throw new BadRequestException('A reversal cannot be dated in the future.');
      return (await this.reverse(tx, id, date, `Reversal of journal ${e.number}${dto.reason ? `: ${dto.reason.trim()}` : ''}`, by)).id;
    });
    return this.journal(newId);
  }

  async trialBalance(asOf = todayKey()) {
    return this.platform(async (tx) => {
      const tb = trialBalance(await this.accountInfo(tx), await this.sums(tx, { to: asOf }));
      return { asOf, balanced: tb.balanced, debit: money(tb.debit), credit: money(tb.credit), rows: tb.rows.map((r) => ({ ...r, debit: money(r.debit), credit: money(r.credit) })) };
    });
  }

  async profitAndLoss(q: RangeQueryDto) {
    const to = q.to ?? todayKey();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('The start day is after the end day.');
    return this.platform(async (tx) => {
      const pl = profitWithTithe(await this.accountInfo(tx), await this.sums(tx, { from, to }), Number((await this.settings(tx)).titheRate));
      const m = <T extends { amount: number }>(rows: T[]) => rows.map((r) => ({ ...r, amount: money(r.amount) }));
      return {
        from,
        to,
        branchId: null,
        income: m(pl.income),
        totalIncome: money(pl.totalIncome),
        costOfSales: m(pl.costOfSales),
        totalCostOfSales: money(pl.totalCostOfSales),
        grossProfit: money(pl.grossProfit),
        expenses: m(pl.expenses),
        totalExpenses: money(pl.totalExpenses),
        profitBeforeTax: money(pl.profitBeforeTax),
        tax: m(pl.tax),
        totalTax: money(pl.totalTax),
        profitAfterTax: money(pl.profitAfterTax),
        titheRate: pl.titheRate,
        tithe: money(pl.tithe),
        netProfit: money(pl.netProfit),
      };
    });
  }

  async balanceSheet(asOf = todayKey()) {
    return this.platform(async (tx) => {
      const bs = balanceSheetWithTithe(await this.accountInfo(tx), await this.sums(tx, { to: asOf }), Number((await this.settings(tx)).titheRate));
      const m = <T extends { amount: number }>(rows: T[]) => rows.map((r) => ({ ...r, amount: money(r.amount) }));
      return {
        asOf,
        assets: m(bs.assets),
        totalAssets: money(bs.totalAssets),
        liabilities: m(bs.liabilities),
        totalLiabilities: money(bs.totalLiabilities),
        equity: m(bs.equity),
        profitToDate: money(bs.profitToDate),
        titheToDate: money(bs.titheToDate),
        totalEquity: money(bs.totalEquity),
        balanced: bs.balanced,
      };
    });
  }

  async accountLedger(accountId: string, q: RangeQueryDto) {
    const to = q.to ?? todayKey();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('The start day is after the end day.');
    return this.platform(async (tx) => {
      const account = await tx.platformLedgerAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundException('Account not found');
      const before = (await this.sums(tx, { before: from })).get(accountId) ?? { debit: 0, credit: 0 };
      const opening = account.type === 'ASSET' || account.type === 'EXPENSE' ? before.debit - before.credit : before.credit - before.debit;
      const lines = await tx.platformJournalLine.findMany({
        where: { accountId, entry: { entryDate: { gte: dateOf(from), lte: dateOf(to) } } },
        include: { entry: { select: { id: true, number: true, entryDate: true, memo: true, kind: true, sourceType: true } } },
        orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { number: 'asc' } }],
        take: 2000,
      });
      const run = withRunningBalance(
        account.type,
        opening,
        lines.map((l) => ({
          entryId: l.entry.id,
          number: l.entry.number,
          date: dayOf(l.entry.entryDate),
          memo: l.memo ?? l.entry.memo,
          kind: l.entry.kind,
          source: l.entry.sourceType ? (PLATFORM_SOURCE_LABELS[l.entry.sourceType] ?? l.entry.sourceType) : null,
          debit: cents(l.debit),
          credit: cents(l.credit),
        })),
      );
      return {
        account: { id: account.id, code: account.code, name: account.name, type: account.type },
        from,
        to,
        opening: money(opening),
        closing: money(run.length ? run[run.length - 1].balance : opening),
        lines: run.map((l) => ({ ...l, debit: money(l.debit), credit: money(l.credit), balance: money(l.balance) })),
        truncated: lines.length === 2000,
      };
    });
  }

  // ── ZARODA's petty cash ──────────────────────────────────────────────────
  // Each entry is posted at once (kind AUTO, source P_PETTY_CASH, so it cannot be reversed by hand); voiding reverses it.

  private async pettyBalance(tx: Tx, before?: string) {
    const rows = await tx.platformPettyCashEntry.findMany({
      where: before ? { occurredOn: { lt: dateOf(before) } } : {},
      select: { kind: true, amount: true, voidedAt: true },
    });
    return boxBalance(rows.map((r) => ({ kind: r.kind, amount: Number(r.amount), voided: !!r.voidedAt })));
  }

  private pettyDay(on?: string) {
    const d = on ?? todayKey();
    if (d > todayKey()) throw new BadRequestException('That date is in the future.');
    return d;
  }

  private async pettyPost(
    tx: Tx,
    data: Prisma.PlatformPettyCashEntryUncheckedCreateInput,
    memo: string,
    lines: (DraftLine | { accountId: string; debit: number; credit: number })[],
    by: { id: string; name: string | null },
  ) {
    const row = await tx.platformPettyCashEntry.create({ data: { ...data, recordedById: by.id, recordedByName: by.name } });
    if (!lines.length) return row;
    const e = await this.write(tx, { date: dayOf(row.occurredOn)!, kind: JournalKind.AUTO, memo, sourceType: 'P_PETTY_CASH', sourceId: row.id, lines, by });
    return tx.platformPettyCashEntry.update({ where: { id: row.id }, data: { entryId: e.id } });
  }

  async pettyCashBook(q: RangeQueryDto) {
    const to = q.to ?? todayKey();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('The start day is after the end day.');
    return this.platform(async (tx) => {
      const s = await this.settings(tx);
      const opening = await this.pettyBalance(tx, from);
      const accounts = await tx.platformLedgerAccount.findMany({ select: { id: true, code: true, name: true } });
      const rows = await tx.platformPettyCashEntry.findMany({ where: { occurredOn: { gte: dateOf(from), lte: dateOf(to) } }, orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }] });
      const lines = withBalance(
        opening,
        rows.map((r) => {
          const a = accounts.find((x) => x.id === r.accountId);
          return {
            id: r.id,
            kind: r.kind,
            voided: !!r.voidedAt,
            amount: Number(r.amount),
            date: dayOf(r.occurredOn),
            voucherNumber: r.voucherNumber,
            account: a ? `${a.code} ${a.name}` : null,
            description: r.description,
            receivedBy: r.receivedBy,
            topUpFrom: r.topUpFrom,
            countedAmount: r.countedAmount === null ? null : Number(r.countedAmount),
            recordedByName: r.recordedByName,
            voidReason: r.voidReason,
          };
        }),
      );
      const balance = await this.pettyBalance(tx);
      const float = Number(s.pettyCashFloat);
      return { float, balance, topUpNeeded: topUpNeeded(float, balance), from, to, opening, lines, closing: lines.length ? lines[lines.length - 1].balance : opening };
    });
  }

  async pettyPay(dto: PlatformPettyPayDto, by: { id: string; name: string | null }) {
    const on = this.pettyDay(dto.occurredOn);
    return this.platform(async (tx) => {
      await this.lock(tx);
      const account = await tx.platformLedgerAccount.findUnique({ where: { id: dto.accountId } });
      if (!account || account.type !== 'EXPENSE' || !account.active) throw new BadRequestException("Choose one of ZARODA's cost accounts.");
      if (account.systemKey === 'INCOME_TAX') throw new BadRequestException('Income tax is not paid from petty cash.');
      const balance = await this.pettyBalance(tx);
      if (dto.amount > balance) throw new BadRequestException(`Only KES ${balance.toLocaleString('en-KE')} is in petty cash. Top it up first.`);
      const year = on.slice(0, 4);
      const last = await tx.platformPettyCashEntry.count({ where: { voucherNumber: { startsWith: `ZPCV-${year}-` } } });
      const voucherNumber = `ZPCV-${year}-${String(last + 1).padStart(4, '0')}`;
      const amount = cents(dto.amount);
      return this.pettyPost(
        tx,
        { kind: 'PAYMENT', voucherNumber, occurredOn: dateOf(on), amount: dto.amount, accountId: account.id, description: dto.description.trim(), receivedBy: dto.receivedBy.trim() },
        `Petty cash ${voucherNumber}: ${dto.description.trim()} (to ${dto.receivedBy.trim()})`,
        [{ accountId: account.id, debit: amount, credit: 0 }, { account: 'PETTY_CASH', debit: 0, credit: amount }],
        by,
      );
    });
  }

  async pettyTopUp(dto: TopUpDto, by: { id: string; name: string | null }) {
    const on = this.pettyDay(dto.occurredOn);
    return this.platform(async (tx) => {
      await this.lock(tx);
      const s = await this.settings(tx);
      const amount = dto.amount ?? topUpNeeded(Number(s.pettyCashFloat), await this.pettyBalance(tx));
      if (amount <= 0) throw new BadRequestException('Petty cash is already at its float. Set the float under Settings, or enter an amount.');
      const from = dto.from === 'MPESA' ? 'MPESA' : dto.from === 'BANK' ? 'BANK' : 'CASH';
      return this.pettyPost(
        tx,
        { kind: 'TOP_UP', occurredOn: dateOf(on), amount, topUpFrom: dto.from, description: dto.description?.trim() || null },
        'Petty cash top-up',
        [{ account: 'PETTY_CASH', debit: cents(amount), credit: 0 }, { account: from, debit: 0, credit: cents(amount) }],
        by,
      );
    });
  }

  async pettyCount(dto: CountDto, by: { id: string; name: string | null }) {
    const on = this.pettyDay(dto.occurredOn);
    return this.platform(async (tx) => {
      await this.lock(tx);
      const expected = await this.pettyBalance(tx);
      const diff = Math.round((dto.counted - expected) * 100) / 100;
      const d = cents(diff);
      const lines: DraftLine[] =
        d < 0
          ? [{ account: 'OTHER_EXPENSES', debit: -d, credit: 0 }, { account: 'PETTY_CASH', debit: 0, credit: -d }]
          : d > 0
            ? [{ account: 'PETTY_CASH', debit: d, credit: 0 }, { account: 'OTHER_INCOME', debit: 0, credit: d }]
            : [];
      return this.pettyPost(
        tx,
        { kind: 'COUNT', occurredOn: dateOf(on), amount: diff, countedAmount: dto.counted, expectedAmount: expected, description: dto.description?.trim() || (d === 0 ? 'Counted: correct' : d < 0 ? 'Counted: short' : 'Counted: over') },
        `Petty cash count: ${d < 0 ? 'short' : 'over'}`,
        lines,
        by,
      );
    });
  }

  async pettyVoid(id: string, dto: VoidEntryDto, by: { id: string; name: string | null }) {
    return this.platform(async (tx) => {
      await this.lock(tx);
      const row = await tx.platformPettyCashEntry.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Entry not found');
      if (row.voidedAt) throw new BadRequestException('This entry is already voided.');
      if (row.kind === 'TOP_UP' && (await this.pettyBalance(tx)) - Number(row.amount) < 0)
        throw new BadRequestException('Petty cash has already spent part of this top-up, so it cannot be voided. Void the payments first, or record a count.');
      if (row.entryId) await this.reverse(tx, row.entryId, todayKey(), `Voided: ${dto.reason.trim()}`, by);
      return tx.platformPettyCashEntry.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
    });
  }
}

