import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JournalKind, Prisma, Role } from '@prisma/client';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AsOfQueryDto, CreateAccountDto, CreateJournalDto, JournalListQueryDto, LedgerSettingsDto, PayOffDto, RangeQueryDto, ReverseJournalDto, UpdateAccountDto, VatQueryDto } from './dto/accounting.dto';
import { addDays, ageOwed, Bucket, BUCKETS, OwedDoc } from './ledger-aging.util';
import { AccountKey } from './ledger-chart';
import { nairobiDayOf } from '../reports/profit.util';
import { Invoice, invoiceVat } from '../etims/etims-purchase.util';
import { vatClaim } from './vat-claim.util';
import { dateOf, dayOf, LedgerBooksService, todayKey } from './ledger-books.service';
import { LedgerPosterService } from './ledger-poster.service';
import { manualProblem, PAYABLE_ACCOUNTS, payOffDraft, postingDate } from './ledger-posting.util';
import { AccountInfo, balanceSheet, cashFlow, isMoneyAccount, profitAndLoss, Row, Sums, trialBalance, withRunningBalance } from './ledger-reports.util';

const PAGE = 50;
/** Aged debtors / creditors: a certified IPC or subcontractor valuation falls due this many days after certification. */
const CERTIFICATE_PAYMENT_DAYS = 30;

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
  CON_RETENTION: 'Retention (construction)',
  CON_IPC_RECEIPT: 'Received against an IPC',
  CON_PAYROLL: 'Site payroll',
  CON_SUB_VALUATION: 'Subcontractor valuation',
  CON_SUB_PAID: 'Paid a subcontractor',
  CON_MATERIAL: 'Materials issued to site',
  ZARODA_CON_PAYMENT: 'Paid ZARODA (construction)',
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
      const input = AccountingService.inputVat(sums, ids);
      return Object.entries(PAYABLE_ACCOUNTS).map(([key, label]) => {
        const s = sums.get(ids.get(key) ?? '') ?? { debit: 0, credit: 0 };
        return { account: key, label, owed: money(s.credit - s.debit - (key === 'VAT_OUTPUT' ? input : 0)) };
      });
    });
  }

  /** The claimable VAT paid on purchases (never below nothing). */
  private static inputVat(sums: Sums, ids: Map<string, string>) {
    const s = sums.get(ids.get('VAT_INPUT') ?? '') ?? { debit: 0, credit: 0 };
    return Math.max(0, s.debit - s.credit);
  }

  /** Records a payment of something owed (VAT, PAYE, tips handed to staff...): it comes off what is owed and out of the money account. */
  async payOff(dto: PayOffDto) {
    if (dto.date > todayKey()) throw new BadRequestException('A payment cannot be dated in the future.');
    const id = await this.tenantPrisma.run(async (tx) => {
      await this.books.lock(tx);
      const offsetCents = dto.account === 'VAT_OUTPUT' ? AccountingService.inputVat(await this.sums(tx, { to: dto.date }), await this.books.accountIds(tx)) : 0;
      const d = payOffDraft({ date: dto.date, account: dto.account, amountCents: cents(dto.amount), paidFrom: dto.paidFrom, reference: dto.reference?.trim() || null, offsetCents });
      const entry = await this.books.write(tx, { date: d.date, kind: JournalKind.MANUAL, memo: d.memo, sourceType: 'PAY_OFF', lines: d.lines, by: await this.me(tx) });
      return entry.id;
    });
    return this.journal(id);
  }

  // ── reports ─────────────────────────────────────────────────────────────

  /** Debits and credits per account between two days (either may be left open), optionally for one branch. */
  private async sums(tx: TenantTx, r: { from?: string; to?: string; before?: string; branchId?: string; projectId?: string }): Promise<Sums> {
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    // days are passed as text and cast, so the database's own time zone never moves them
    if (r.from) conds.push(Prisma.sql`e."entryDate" >= ${r.from}::date`);
    if (r.to) conds.push(Prisma.sql`e."entryDate" <= ${r.to}::date`);
    if (r.before) conds.push(Prisma.sql`e."entryDate" < ${r.before}::date`);
    if (r.branchId) conds.push(Prisma.sql`e."branchId" = ${r.branchId}`);
    if (r.projectId) conds.push(Prisma.sql`e."projectId" = ${r.projectId}`);
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
      const pl = profitAndLoss(await this.accountInfo(tx), await this.sums(tx, { from, to, branchId: q.branchId, projectId: q.projectId }));
      const m = AccountingService.moneyRows;
      return {
        from,
        to,
        branchId: q.branchId ?? null,
        projectId: q.projectId ?? null,
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

  /** Where the money came from and went over a period: opening cash, operating / investing / financing, closing cash. */
  async cashFlow(q: RangeQueryDto) {
    const to = q.to ?? todayKey();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new BadRequestException('The start day is after the end day.');
    return this.tenantPrisma.run(async (tx) => {
      const accounts = await this.accountInfo(tx);
      const moneyIds = accounts.filter(isMoneyAccount).map((a) => a.id);
      const cash = (s: Sums) => moneyIds.reduce((t, id) => t + (s.get(id)?.debit ?? 0) - (s.get(id)?.credit ?? 0), 0);
      const effects = new Map<string, number>();
      if (moneyIds.length) {
        const rows = await tx.$queryRaw<{ accountId: string; amount: Prisma.Decimal }[]>(Prisma.sql`
          SELECT l."accountId", SUM(l.credit - l.debit) AS amount FROM journal_lines l
          WHERE l."accountId" NOT IN (${Prisma.join(moneyIds)}) AND l."entryId" IN (
            SELECT m."entryId" FROM journal_lines m JOIN journal_entries e ON e.id = m."entryId"
            WHERE m."accountId" IN (${Prisma.join(moneyIds)}) AND e."entryDate" >= ${from}::date AND e."entryDate" <= ${to}::date)
          GROUP BY l."accountId"`);
        for (const r of rows) effects.set(r.accountId, cents(r.amount));
      }
      const cf = cashFlow(accounts, effects, cash(await this.sums(tx, { before: from })), cash(await this.sums(tx, { to })));
      const part = (p: { rows: Row[]; total: number }) => ({ rows: AccountingService.moneyRows(p.rows), total: money(p.total) });
      return { from, to, opening: money(cf.opening), operating: part(cf.operating), investing: part(cf.investing), financing: part(cf.financing), net: money(cf.net), closing: money(cf.closing), reconciles: cf.reconciles };
    });
  }

  /** Who owes us, by how late: school invoices, construction IPCs and retention, rent. Compared with the debtor accounts in the books. */
  async debtors() {
    const today = todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const docs: OwedDoc[] = [];
      const schools = await tx.supplierInvoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, include: { school: { select: { name: true } } } });
      for (const i of schools) {
        const owed = cents(i.total) - cents(i.creditAmount) - cents(i.amountPaid) - cents(i.writtenOffAmount);
        const held = Math.min(owed, cents(i.retentionHeld));
        docs.push({ party: i.school.name, kind: 'Invoice', reference: i.invoiceNumber, date: dayOf(i.issueDate)!, dueDate: dayOf(i.dueDate), owedCents: owed - held });
        if (held > 0) docs.push({ party: i.school.name, kind: 'Retention', reference: i.invoiceNumber, date: dayOf(i.issueDate)!, dueDate: null, owedCents: held });
      }
      const ipcs = await tx.conValuation.findMany({
        where: { saleId: { not: null } },
        include: { project: { select: { code: true, name: true, client: { select: { name: true } } } }, receipts: { select: { amount: true } } },
      });
      const sales = new Map(
        (await tx.sale.findMany({ where: { id: { in: ipcs.map((v) => v.saleId!) } }, select: { id: true, total: true, createdAt: true, refunds: { select: { amount: true } } } })).map((s) => [s.id, s]),
      );
      for (const v of ipcs) {
        const s = sales.get(v.saleId!);
        if (!s) continue;
        const owed = cents(s.total) - s.refunds.reduce((t, r) => t + cents(r.amount), 0) - v.receipts.reduce((t, r) => t + cents(r.amount), 0);
        const date = dayOf(v.certifiedAt) ?? nairobiDayOf(s.createdAt);
        docs.push({ party: v.project.client?.name ?? v.project.name, kind: 'IPC', reference: `${v.project.code} IPC ${v.number}`, date, dueDate: addDays(date, CERTIFICATE_PAYMENT_DAYS), owedCents: owed });
      }
      const held = await tx.$queryRaw<{ projectId: string; held: Prisma.Decimal }[]>(
        Prisma.sql`SELECT "projectId", SUM(CASE type WHEN 'DEDUCT' THEN amount ELSE -amount END) AS held FROM con_retention_ledger GROUP BY "projectId"`,
      );
      if (held.length) {
        const projects = new Map((await tx.conProject.findMany({ where: { id: { in: held.map((h) => h.projectId) } }, select: { id: true, code: true, name: true, startDate: true, client: { select: { name: true } } } })).map((p) => [p.id, p]));
        for (const h of held) {
          const p = projects.get(h.projectId);
          if (p) docs.push({ party: p.client?.name ?? p.name, kind: 'Retention', reference: p.code, date: dayOf(p.startDate) ?? today, dueDate: null, owedCents: cents(h.held) });
        }
      }
      const rent = await tx.rentalInvoice.findMany({ where: { amountDue: { gt: 0 } }, include: { lease: { select: { tenant: { select: { name: true } }, unit: { select: { label: true } } } } } });
      for (const r of rent) {
        const due = dayOf(r.dueDate)!;
        docs.push({ party: r.lease.tenant.name, kind: r.kind === 'RENT' ? 'Rent' : r.kind === 'DEPOSIT' ? 'Deposit' : 'Charge', reference: `${r.lease.unit.label}${r.periodMonth ? ` ${dayOf(r.periodMonth)!.slice(0, 7)}` : ''}`, date: due, dueDate: due, owedCents: cents(r.amountDue) - cents(r.amountPaid) });
      }
      return this.agedView(tx, ageOwed(docs, today), today, ['AR', 'RENT_AR', 'RETENTION_RECEIVABLE'], 1);
    });
  }

  /** Who we owe, by how late: supplier bills, approved subcontractor valuations and the retention we hold from subcontractors. */
  async creditors() {
    const today = todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const docs: OwedDoc[] = [];
      const bills = await tx.supplierBill.findMany({ where: { status: { notIn: ['VOID', 'PAID'] } }, include: { supplier: { select: { name: true } } } });
      for (const b of bills) docs.push({ party: b.supplier.name, kind: 'Bill', reference: b.billNumber, date: dayOf(b.billDate)!, dueDate: dayOf(b.dueDate), owedCents: cents(b.total) - cents(b.creditAmount) - cents(b.amountPaid) });
      const subs = await tx.conSubValuation.findMany({
        where: { status: { in: ['APPROVED', 'PAID'] } },
        orderBy: { number: 'asc' },
        include: { subcontract: { select: { ref: true, party: { select: { name: true } } } } },
      });
      const retention = new Map<string, { party: string; ref: string; date: string; cents: number }>();
      for (const v of subs) {
        const party = v.subcontract.party.name;
        const date = dayOf(v.approvedAt) ?? today;
        if (v.status === 'APPROVED') docs.push({ party, kind: 'Subcontract valuation', reference: `${v.subcontract.ref} no. ${v.number}`, date, dueDate: addDays(date, CERTIFICATE_PAYMENT_DAYS), owedCents: cents(v.netDue) });
        retention.set(v.subcontractId, { party, ref: v.subcontract.ref, date, cents: cents(v.retention) });
      }
      for (const r of retention.values()) docs.push({ party: r.party, kind: 'Retention', reference: r.ref, date: r.date, dueDate: null, owedCents: r.cents });
      return this.agedView(tx, ageOwed(docs, today), today, ['AP', 'RETENTION_PAYABLE'], -1);
    });
  }

  /** The aged list in shillings, with what the matching accounts hold in the books (sign: 1 for assets, -1 for liabilities). */
  private async agedView(tx: TenantTx, aged: ReturnType<typeof ageOwed>, today: string, keys: string[], sign: 1 | -1) {
    const ids = await this.books.accountIds(tx);
    const sums = await this.sums(tx, { to: today });
    const books = keys
      .filter((k) => ids.has(k as AccountKey))
      .map((k) => {
        const s = sums.get(ids.get(k as AccountKey)!) ?? { debit: 0, credit: 0 };
        return { account: k, balance: money(sign * (s.debit - s.credit)) };
      });
    const amounts = <T extends Record<Bucket | 'total', number>>(r: T) => ({ ...r, ...Object.fromEntries([...BUCKETS, 'total'].map((b) => [b, money(r[b as Bucket])])) });
    return {
      asOf: today,
      rows: aged.rows.map(amounts),
      totals: amounts(aged.totals),
      documents: aged.documents.map(({ owedCents, ...d }) => ({ ...d, owed: money(owedCents) })),
      books,
      booksTotal: money(books.reduce((t, b) => t + cents(b.balance), 0)),
    };
  }

  /**
   * The VAT return for a month: output VAT on sales (by VAT class), less refunds, input VAT on bills and expenses, and withholding VAT
   * certificates received. Totals are the VAT accounts in the books; documents give the detail.
   */
  async vatReturn(q: VatQueryDto) {
    const month = q.month ?? todayKey().slice(0, 7);
    const from = `${month}-01`;
    const next = new Date(Date.parse(`${from}T00:00:00Z`));
    next.setUTCMonth(next.getUTCMonth() + 1);
    const to = addDays(next.toISOString().slice(0, 10), -1);
    const start = new Date(`${from}T00:00:00+03:00`);
    const end = new Date(`${next.toISOString().slice(0, 10)}T00:00:00+03:00`);
    return this.tenantPrisma.run(async (tx) => {
      const ids = await this.books.accountIds(tx);
      const vatMove = async (key: AccountKey) => {
        const id = ids.get(key);
        if (!id) return 0;
        const r = await tx.$queryRaw<{ v: Prisma.Decimal | null }[]>(Prisma.sql`
          SELECT SUM(l.debit - l.credit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
          WHERE l."accountId" = ${id} AND e."entryDate" >= ${from}::date AND e."entryDate" <= ${to}::date AND COALESCE(e."sourceType", '') <> 'PAY_OFF'`);
        return cents(r[0]?.v);
      };
      const classes = await tx.$queryRaw<{ name: string | null; rate: Prisma.Decimal | null; isExempt: boolean | null; net: Prisma.Decimal; tax: Prisma.Decimal }[]>(Prisma.sql`
        SELECT tc.name, tc.rate, tc."isExempt", SUM(li.quantity * li."unitPrice") AS net, SUM(li."taxAmount") AS tax
        FROM sale_line_items li JOIN sales s ON s.id = li."saleId" JOIN product_variants v ON v.id = li."variantId" JOIN products p ON p.id = v."productId"
        LEFT JOIN tax_classes tc ON tc.id = p."taxClassId"
        WHERE s.status::text = 'COMPLETED' AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
        GROUP BY tc.id, tc.name, tc.rate, tc."isExempt"`);
      const sales = classes
        .map((c) => ({
          label: c.name === null ? 'No VAT class set' : c.isExempt ? `${c.name} (exempt)` : `${c.name} (${Math.round(Number(c.rate) * 10000) / 100}%)`,
          rate: c.rate === null || c.isExempt ? null : Number(c.rate),
          netCents: cents(c.net),
          vatCents: cents(c.tax),
        }))
        .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
      const refundRows = await tx.$queryRaw<{ amount: Prisma.Decimal; total: Prisma.Decimal; tax: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT r.amount, s.total, (SELECT SUM(li."taxAmount") FROM sale_line_items li WHERE li."saleId" = s.id) AS tax
        FROM refunds r JOIN sales s ON s.id = r."saleId" WHERE r."createdAt" >= ${start} AND r."createdAt" < ${end}`);
      const refundVat = refundRows.reduce((t, r) => t + (cents(r.total) > 0 ? Math.round((cents(r.amount) * cents(r.tax)) / cents(r.total)) : 0), 0);
      const refundGross = refundRows.reduce((t, r) => t + cents(r.amount), 0);
      const outputVat = -(await vatMove('VAT_OUTPUT'));
      const salesVat = sales.reduce((t, s) => t + s.vatCents, 0);

      // every purchase with VAT this month, and whether KRA will accept the claim (see vat-claim.util)
      const bills = await tx.supplierBill.findMany({
        where: { status: { not: 'VOID' }, taxAmount: { gt: 0 }, billDate: { gte: dateOf(from), lte: dateOf(to) } },
        include: { supplier: { select: { name: true, kraPin: true } } },
        orderBy: { billDate: 'asc' },
      });
      const expenses = await tx.expense.findMany({ where: { taxAmount: { gt: 0 }, spentOn: { gte: dateOf(from), lte: dateOf(to) } }, orderBy: { spentOn: 'asc' } });
      const docs = [
        ...bills.map((b) => ({ kind: 'Bill', date: dayOf(b.billDate)!, reference: b.billNumber, pin: b.supplier.kraPin, name: b.supplier.name, invoiceNo: b.kraInvoiceNo, linked: !!b.etimsInvoiceId, grossCents: cents(b.total), taxCents: cents(b.taxAmount) })),
        ...expenses.map((e) => ({ kind: 'Expense', date: dayOf(e.spentOn)!, reference: e.description ?? e.category, pin: e.supplierPin, name: e.supplierName, invoiceNo: e.kraInvoiceNo, linked: !!e.etimsInvoiceId, grossCents: cents(e.amount), taxCents: cents(e.taxAmount) })),
      ].map((d) => ({ ...d, claim: vatClaim(d) }));
      const claimed = docs.filter((d) => d.claim === 'KRA' || d.claim === 'DECLARED');
      const missing = docs.filter((d) => d.claim === 'MISSING');
      const part = (rows: typeof docs) => ({ count: rows.length, net: money(rows.reduce((t, r) => t + r.grossCents - r.taxCents, 0)), vat: money(rows.reduce((t, r) => t + r.taxCents, 0)) });
      const billPart = part(claimed.filter((d) => d.kind === 'Bill'));
      const expensePart = part(claimed.filter((d) => d.kind === 'Expense'));
      const inputVat = await vatMove('VAT_INPUT');

      // KRA's own list of what suppliers sold us this month, not yet entered as a bill or expense
      const kraInvoices = await tx.etimsPurchaseInvoice.findMany({
        where: { rcptTyCd: 'S', status: { not: 'DISMISSED' }, bill: null, expense: null, salesDt: { gte: from.replace(/-/g, ''), lt: `${addDays(to, 1).replace(/-/g, '')}` } },
        orderBy: { salesDt: 'asc' },
      });
      const notEntered = kraInvoices.map((k) => ({ id: k.id, pin: k.spplrTin, name: k.spplrNm, invoiceNo: String(k.spplrInvcNo), date: `${k.salesDt!.slice(0, 4)}-${k.salesDt!.slice(4, 6)}-${k.salesDt!.slice(6, 8)}`, total: money(cents(k.totAmt)), vat: invoiceVat(k.body as unknown as Invoice) }));

      // sales KRA has not confirmed yet (only once sending sales to eTIMS is on)
      const etims = await tx.etimsSetting.findFirst({ select: { sendSales: true, salesStartAt: true } });
      let salesNotSent: number | null = null;
      if (etims?.sendSales) {
        const since = etims.salesStartAt && etims.salesStartAt > start ? etims.salesStartAt : start;
        const r = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
          SELECT count(*)::int AS n FROM sales s WHERE s.status::text = 'COMPLETED' AND s.total > 0 AND s."createdAt" >= ${since} AND s."createdAt" < ${end}
          AND NOT EXISTS (SELECT 1 FROM etims_documents d WHERE d."saleId" = s.id AND d.kind::text = 'SALE' AND d.status::text = 'SENT')`);
        salesNotSent = r[0]?.n ?? 0;
      }

      const wht = await tx.conValuationReceipt.findMany({
        where: { kind: 'WHT_VAT', receivedAt: { gte: dateOf(from), lte: dateOf(to) } },
        include: { valuation: { select: { number: true, project: { select: { code: true } } } } },
        orderBy: { receivedAt: 'asc' },
      });
      const whtVat = wht.reduce((t, w) => t + cents(w.amount), 0);
      const payable = outputVat - inputVat - whtVat;
      return {
        month,
        from,
        to,
        sales: sales.map((s) => ({ label: s.label, rate: s.rate, net: money(s.netCents), vat: money(s.vatCents) })),
        salesNet: money(sales.reduce((t, s) => t + s.netCents, 0)),
        salesVat: money(salesVat),
        refunds: { count: refundRows.length, gross: money(refundGross), vat: money(refundVat) },
        otherOutputVat: money(outputVat - (salesVat - refundVat)),
        outputVat: money(outputVat),
        purchases: {
          bills: billPart,
          expenses: expensePart,
          checkedWithKra: money(claimed.filter((d) => d.claim === 'KRA').reduce((t, d) => t + d.taxCents, 0)),
          // the purchases schedule of the iTax VAT return: supplier PIN, name, date, invoice number, value before VAT, VAT
          schedule: claimed.map((d) => ({ kind: d.kind, pin: d.pin, name: d.name, date: d.date, invoiceNo: d.invoiceNo, reference: d.reference, net: money(d.grossCents - d.taxCents), vat: money(d.taxCents), checked: d.claim === 'KRA' })),
          notClaimable: { count: missing.length, vat: money(missing.reduce((t, d) => t + d.taxCents, 0)), documents: missing.map((d) => ({ kind: d.kind, date: d.date, reference: d.reference, name: d.name, vat: money(d.taxCents) })) },
          kraNotEntered: notEntered,
        },
        salesNotSent,
        otherInputVat: money(inputVat - cents(billPart.vat) - cents(expensePart.vat)),
        inputVat: money(inputVat),
        withholdingVat: { total: money(whtVat), certificates: wht.map((w) => ({ date: dayOf(w.receivedAt), reference: `${w.valuation.project.code} IPC ${w.valuation.number}`, certificateNo: w.certificateNo, amount: money(cents(w.amount)) })) },
        payable: money(Math.max(0, payable)),
        creditCarriedForward: money(Math.max(0, -payable)),
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
