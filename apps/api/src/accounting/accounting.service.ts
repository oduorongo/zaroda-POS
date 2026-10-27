import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JournalKind, Prisma, Role } from '@prisma/client';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AsOfQueryDto, CreateAccountDto, CreateJournalDto, JournalListQueryDto, LedgerSettingsDto, PayOffDto, RangeQueryDto, ReverseJournalDto, UpdateAccountDto } from './dto/accounting.dto';
import { dateOf, dayOf, LedgerBooksService, todayKey } from './ledger-books.service';
import { LedgerPosterService } from './ledger-poster.service';
import { manualProblem, PAYABLE_ACCOUNTS, payOffDraft, postingDate } from './ledger-posting.util';
import { AccountInfo, balanceSheet, profitAndLoss, Sums, trialBalance, withRunningBalance } from './ledger-reports.util';

const PAGE = 50;

/**
 * What an entry is worth on the list: its debits, leaving out the cost of goods moving out of stock (a sale of 6,240 whose goods
 * cost 2,585 shows as 6,240, not 8,825). A reversal shows the same figure as the entry it undoes.
 */
function entryAmount(lines: { debit: unknown; credit: unknown; account: { systemKey: string | null } }[]) {
  const costMoved = lines.filter((l) => l.account.systemKey === 'COGS').reduce((t, l) => t + cents(l.debit) + cents(l.credit), 0);
  return lines.reduce((t, l) => t + cents(l.debit), 0) - costMoved;
}
const money = (cents: number) => Math.round(cents) / 100;
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** What each automatic source is called on the screens. */
export const SOURCE_LABELS: Record<string, string> = {
  SALE: 'Sale',
  REFUND: 'Refund',
  EXPENSE: 'Expense',
  BILL: "Supplier's bill",
  BILL_CREDIT: "Supplier's credit",
  BILL_PAYMENT: 'Payment to a supplier',
  PAYROLL: 'Payroll',
  SCHOOL_RECEIPT: 'Receipt from a school',
  SCHOOL_BOUNCE: 'Bounced cheque',
  WRITE_OFF: 'Bad debt written off',
  WRITE_OFF_REVERSAL: 'Write-off put back',
  PROVISION: 'Bad debt provision',
  RENT_INVOICE: 'Rent charged',
  RENT_PAYMENT: 'Rent received',
  RENT_PAYMENT_VOID: 'Rent payment voided',
  WASTE: 'Waste',
  LAYAWAY_PAYMENT: 'Layaway payment',
  LAYAWAY_DONE: 'Layaway collected',
  FOLIO_MONEY: 'Hotel guest payment',
  HOTEL_CANCEL_FEE: 'Cancellation fee kept',
  TIP: 'Tip and service charge',
  STOCK_COUNT: 'Stock count',
  LEASE_END: 'Lease ended (deposit)',
  ZARODA_SUBSCRIPTION: 'ZARODA subscription',
  ZARODA_INVOICE: 'ZARODA invoice',
  ZARODA_INVOICE_PAID: 'ZARODA invoice paid',
  ZARODA_RENTAL_INVOICE: 'ZARODA rental plan invoice',
  ZARODA_RENTAL_INVOICE_PAID: 'ZARODA rental plan invoice paid',
  ZARODA_ADVERT: 'House advert fee',
  PAY_OFF: 'Paid what was owed',
};

/**
 * The general ledger for the screens: the chart of accounts, journals (automatic ones from the poster, and the business's own),
 * closing a period, and the trial balance, profit and loss, balance sheet and account ledger.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly books: LedgerBooksService,
    private readonly poster: LedgerPosterService,
  ) {}

  private async me(tx: TenantTx) {
    const { orgUserId } = getTenantStore();
    const u = await tx.orgUser.findUnique({ where: { id: orgUserId }, select: { user: { select: { fullName: true } } } });
    return { id: orgUserId, name: u?.user.fullName ?? null };
  }

  // ── settings ────────────────────────────────────────────────────────────

  async overview() {
    return this.tenantPrisma.run(async (tx) => {
      const s = await this.books.settings(tx);
      const [entries, accounts, waiting] = await Promise.all([
        tx.journalEntry.count(),
        tx.ledgerAccount.count(),
        tx.ledgerPosting.count({ where: { entryId: null } }),
      ]);
      return {
        startDate: dayOf(s.startDate),
        lockDate: dayOf(s.lockDate),
        payrollPaidFrom: s.payrollPaidFrom,
        lastPassAt: s.lastPassAt,
        lastPassNote: s.lastPassNote,
        entries,
        accounts,
        sourcesWithNothingToPost: waiting,
      };
    });
  }

  async updateSettings(dto: LedgerSettingsDto) {
    const { organizationId, role } = getTenantStore();
    await this.tenantPrisma.run(async (tx) => {
      await this.books.lock(tx);
      const s = await this.books.settings(tx);
      const data: Prisma.LedgerSettingsUpdateInput = {};
      if (dto.startDate !== undefined && dto.startDate !== dayOf(s.startDate)) {
        if (dto.startDate > todayKey()) throw new BadRequestException('The books cannot start in the future.');
        const posted = await tx.ledgerPosting.count();
        if (posted > 0 && dto.startDate > dayOf(s.startDate)!)
          throw new ConflictException('Things have already been posted from the current start date, so it can only be moved earlier.');
        data.startDate = dateOf(dto.startDate);
      }
      if (dto.lockDate !== undefined) {
        if (role !== Role.OWNER) throw new ForbiddenException('Only the owner can close or reopen the books.');
        if (dto.lockDate && dto.lockDate >= todayKey()) throw new BadRequestException('The books can only be closed up to yesterday.');
        data.lockDate = dto.lockDate ? dateOf(dto.lockDate) : null;
      }
      if (dto.payrollPaidFrom) data.payrollPaidFrom = dto.payrollPaidFrom;
      await tx.ledgerSettings.update({ where: { organizationId }, data });
    });
    return this.overview();
  }

  /** Posts now instead of waiting for the next timed pass. */
  postNow() {
    return this.poster.runPass();
  }

  // ── accounts ────────────────────────────────────────────────────────────

  async accounts() {
    return this.tenantPrisma.run(async (tx) => {
      await this.books.settings(tx);
      await this.books.ensureChart(tx);
      const [list, sums] = await Promise.all([tx.ledgerAccount.findMany(), this.sums(tx, {})]);
      return list
        .map((a) => {
          const s = sums.get(a.id) ?? { debit: 0, credit: 0 };
          const normal = a.type === 'ASSET' || a.type === 'EXPENSE' ? s.debit - s.credit : s.credit - s.debit;
          return { ...a, balance: money(normal), system: !!a.systemKey };
        })
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    });
  }

  async createAccount(dto: CreateAccountDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await this.books.settings(tx);
      if (await tx.ledgerAccount.findFirst({ where: { code: dto.code } })) throw new ConflictException(`Account code ${dto.code} is already used.`);
      return tx.ledgerAccount.create({ data: { organizationId, code: dto.code, name: dto.name.trim(), type: dto.type, description: dto.description?.trim() || null } });
    });
  }

  async updateAccount(id: string, dto: UpdateAccountDto) {
    return this.tenantPrisma.run(async (tx) => {
      const a = await tx.ledgerAccount.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('Account not found');
      if (a.systemKey && dto.type && dto.type !== a.type) throw new BadRequestException('The kind of this account is fixed because the system posts to it.');
      if (a.systemKey && dto.active === false) throw new BadRequestException('This account is used by automatic postings, so it cannot be switched off.');
      if (dto.type && dto.type !== a.type && (await tx.journalLine.count({ where: { accountId: id } })) > 0)
        throw new BadRequestException('This account already has entries, so its kind cannot change.');
      if (dto.code && dto.code !== a.code && (await tx.ledgerAccount.findFirst({ where: { code: dto.code } })))
        throw new ConflictException(`Account code ${dto.code} is already used.`);
      return tx.ledgerAccount.update({
        where: { id },
        data: {
          code: dto.code,
          name: dto.name?.trim(),
          type: dto.type,
          description: dto.description === undefined ? undefined : dto.description.trim() || null,
          active: dto.active,
        },
      });
    });
  }

  // ── journals ────────────────────────────────────────────────────────────

  async journals(q: JournalListQueryDto) {
    const page = q.page ?? 1;
    return this.tenantPrisma.run(async (tx) => {
      const where: Prisma.JournalEntryWhereInput = {
        kind: q.kind,
        sourceType: q.sourceType,
        sourceId: q.sourceId,
        branchId: q.branchId,
        entryDate: q.from || q.to ? { gte: q.from ? dateOf(q.from) : undefined, lte: q.to ? dateOf(q.to) : undefined } : undefined,
        memo: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
      };
      const [total, rows] = await Promise.all([
        tx.journalEntry.count({ where }),
        tx.journalEntry.findMany({
          where,
          orderBy: [{ entryDate: 'desc' }, { number: 'desc' }],
          skip: (page - 1) * PAGE,
          take: PAGE,
          include: { lines: { select: { debit: true, credit: true, account: { select: { systemKey: true, code: true, name: true } } } }, reversedBy: { select: { id: true, number: true } } },
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
          source: e.sourceType ? (SOURCE_LABELS[e.sourceType] ?? e.sourceType) : null,
          amount: money(entryAmount(e.lines)),
          lines: e.lines.map((l) => ({ code: l.account.code, name: l.account.name, debit: Number(l.debit), credit: Number(l.credit) })).sort((a, b) => (b.debit > 0 ? 1 : 0) - (a.debit > 0 ? 1 : 0) || a.code.localeCompare(b.code, undefined, { numeric: true })),
          reversedBy: e.reversedBy,
          reverses: e.reversesId,
        })),
      };
    });
  }

  async journal(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const e = await tx.journalEntry.findUnique({
        where: { id },
        include: {
          lines: { include: { account: { select: { code: true, name: true } } } },
          reversedBy: { select: { id: true, number: true } },
          reverses: { select: { id: true, number: true } },
        },
      });
      if (!e) throw new NotFoundException('Journal not found');
      return {
        id: e.id,
        number: e.number,
        date: dayOf(e.entryDate),
        kind: e.kind,
        memo: e.memo,
        sourceType: e.sourceType,
        source: e.sourceType ? (SOURCE_LABELS[e.sourceType] ?? e.sourceType) : null,
        sourceId: e.sourceId,
        branchId: e.branchId,
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

  async createJournal(dto: CreateJournalDto) {
    const lines = dto.lines.map((l) => ({ accountId: l.accountId, debit: cents(l.debit), credit: cents(l.credit), memo: l.memo?.trim() || null }));
    const problem = manualProblem(lines);
    if (problem) throw new BadRequestException(problem);
    if (dto.date > todayKey()) throw new BadRequestException('A journal cannot be dated in the future.');
    const id = await this.tenantPrisma.run(async (tx) => {
      await this.books.lock(tx);
      const accounts = await tx.ledgerAccount.findMany({ where: { id: { in: lines.map((l) => l.accountId) } } });
      if (accounts.length !== new Set(lines.map((l) => l.accountId)).size) throw new BadRequestException('One of the accounts was not found.');
      const off = accounts.find((a) => !a.active);
      if (off) throw new BadRequestException(`Account ${off.code} ${off.name} is switched off.`);
      const entry = await this.books.write(tx, {
        date: dto.date,
        kind: dto.kind === 'OPENING' ? JournalKind.OPENING : JournalKind.MANUAL,
        memo: dto.memo.trim(),
        branchId: dto.branchId ?? null,
        lines,
        by: await this.me(tx),
      });
      return entry.id;
    });
    return this.journal(id);
  }

  /** Undoes a journal the business entered. Automatic entries follow their source instead: void the sale, correct the expense... */
  async reverseJournal(id: string, dto: ReverseJournalDto) {
    const newId = await this.tenantPrisma.run(async (tx) => {
      await this.books.lock(tx);
      const e = await tx.journalEntry.findUnique({ where: { id }, include: { reversedBy: true } });
      if (!e) throw new NotFoundException('Journal not found');
      if (e.kind === JournalKind.AUTO || (e.kind === JournalKind.REVERSAL && e.sourceType))
        throw new BadRequestException('This entry was posted automatically. Correct or void the sale, bill or payment it came from and the books follow.');
      if (e.kind === JournalKind.REVERSAL) throw new BadRequestException('This entry is itself a reversal.');
      if (e.reversedBy) throw new ConflictException(`This journal was already reversed by journal ${e.reversedBy.number}.`);
      const s = await this.books.settings(tx);
      const date = dto.date ?? postingDate(todayKey(), dayOf(s.lockDate));
      if (date > todayKey()) throw new BadRequestException('A reversal cannot be dated in the future.');
      const r = await this.books.reverse(tx, id, date, `Reversal of journal ${e.number}${dto.reason ? `: ${dto.reason.trim()}` : ''}`, await this.me(tx));
      return r.id;
    });
    return this.journal(newId);
  }

  // ── paying what is owed ─────────────────────────────────────────────────

  /** What the business owes to KRA, NSSF, SHIF and its staff (tips), as the books stand today. */
  async owed() {
    return this.tenantPrisma.run(async (tx) => {
      await this.books.settings(tx);
      const ids = await this.books.accountIds(tx);
      const sums = await this.sums(tx, { to: todayKey() });
      return Object.entries(PAYABLE_ACCOUNTS).map(([key, label]) => {
        const s = sums.get(ids.get(key) ?? '') ?? { debit: 0, credit: 0 };
        return { account: key, label, owed: money(s.credit - s.debit) };
      });
    });
  }

  /** Records a payment of something owed (VAT, PAYE, tips handed to staff...): it comes off what is owed and out of the money account. */
  async payOff(dto: PayOffDto) {
    if (dto.date > todayKey()) throw new BadRequestException('A payment cannot be dated in the future.');
    const id = await this.tenantPrisma.run(async (tx) => {
      await this.books.lock(tx);
      const d = payOffDraft({ date: dto.date, account: dto.account, amountCents: cents(dto.amount), paidFrom: dto.paidFrom, reference: dto.reference?.trim() || null });
      const entry = await this.books.write(tx, { date: d.date, kind: JournalKind.MANUAL, memo: d.memo, sourceType: 'PAY_OFF', lines: d.lines, by: await this.me(tx) });
      return entry.id;
    });
    return this.journal(id);
  }

  // ── reports ─────────────────────────────────────────────────────────────

  /** Debits and credits per account between two days (either may be left open), optionally for one branch. */
  private async sums(tx: TenantTx, r: { from?: string; to?: string; before?: string; branchId?: string }): Promise<Sums> {
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    // days are passed as text and cast, so the database's own time zone never moves them
    if (r.from) conds.push(Prisma.sql`e."entryDate" >= ${r.from}::date`);
    if (r.to) conds.push(Prisma.sql`e."entryDate" <= ${r.to}::date`);
    if (r.before) conds.push(Prisma.sql`e."entryDate" < ${r.before}::date`);
    if (r.branchId) conds.push(Prisma.sql`e."branchId" = ${r.branchId}`);
    const rows = await tx.$queryRaw<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>(
      Prisma.sql`SELECT l."accountId", SUM(l.debit) AS debit, SUM(l.credit) AS credit FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId" WHERE ${Prisma.join(conds, ' AND ')} GROUP BY l."accountId"`,
    );
    return new Map(rows.map((x) => [x.accountId, { debit: cents(x.debit), credit: cents(x.credit) }]));
  }

  private async accountInfo(tx: TenantTx): Promise<AccountInfo[]> {
    await this.books.settings(tx);
    return tx.ledgerAccount.findMany({ select: { id: true, code: true, name: true, type: true, systemKey: true } });
  }

  private static moneyRows<T extends { amount: number }>(rows: T[]) {
    return rows.map((r) => ({ ...r, amount: money(r.amount) }));
  }

  async trialBalance(q: AsOfQueryDto) {
    const asOf = q.asOf ?? todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const tb = trialBalance(await this.accountInfo(tx), await this.sums(tx, { to: asOf }));
      return { asOf, balanced: tb.balanced, debit: money(tb.debit), credit: money(tb.credit), rows: tb.rows.map((r) => ({ ...r, debit: money(r.debit), credit: money(r.credit) })) };
    });
  }

  async profitAndLoss(q: RangeQueryDto) {
    const to = q.to ?? todayKey();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('The start day is after the end day.');
    return this.tenantPrisma.run(async (tx) => {
      const pl = profitAndLoss(await this.accountInfo(tx), await this.sums(tx, { from, to, branchId: q.branchId }));
      const m = AccountingService.moneyRows;
      return {
        from,
        to,
        branchId: q.branchId ?? null,
        income: m(pl.income),
        totalIncome: money(pl.totalIncome),
        costOfSales: m(pl.costOfSales),
        totalCostOfSales: money(pl.totalCostOfSales),
        grossProfit: money(pl.grossProfit),
        expenses: m(pl.expenses),
        totalExpenses: money(pl.totalExpenses),
        netProfit: money(pl.netProfit),
      };
    });
  }

  async balanceSheet(q: AsOfQueryDto) {
    const asOf = q.asOf ?? todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const bs = balanceSheet(await this.accountInfo(tx), await this.sums(tx, { to: asOf }));
      const m = AccountingService.moneyRows;
      return {
        asOf,
        assets: m(bs.assets),
        totalAssets: money(bs.totalAssets),
        liabilities: m(bs.liabilities),
        totalLiabilities: money(bs.totalLiabilities),
        equity: m(bs.equity),
        profitToDate: money(bs.profitToDate),
        totalEquity: money(bs.totalEquity),
        balanced: bs.balanced,
      };
    });
  }

  /** One account's movements between two days with the running balance (the first 2000 lines). */
  async accountLedger(accountId: string, q: RangeQueryDto) {
    const to = q.to ?? todayKey();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('The start day is after the end day.');
    return this.tenantPrisma.run(async (tx) => {
      const account = await tx.ledgerAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundException('Account not found');
      const before = (await this.sums(tx, { before: from, branchId: q.branchId })).get(accountId) ?? { debit: 0, credit: 0 };
      const opening = account.type === 'ASSET' || account.type === 'EXPENSE' ? before.debit - before.credit : before.credit - before.debit;
      const lines = await tx.journalLine.findMany({
        where: { accountId, entry: { entryDate: { gte: dateOf(from), lte: dateOf(to) }, branchId: q.branchId } },
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
          source: l.entry.sourceType ? (SOURCE_LABELS[l.entry.sourceType] ?? l.entry.sourceType) : null,
          debit: cents(l.debit),
          credit: cents(l.credit),
        })),
      );
      const closing = run.length ? run[run.length - 1].balance : opening;
      return {
        account: { id: account.id, code: account.code, name: account.name, type: account.type },
        from,
        to,
        opening: money(opening),
        closing: money(closing),
        lines: run.map((l) => ({ ...l, debit: money(l.debit), credit: money(l.credit), balance: money(l.balance) })),
        truncated: lines.length === 2000,
      };
    });
  }
}
