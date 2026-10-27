import { Injectable, Logger } from '@nestjs/common';
import { JournalKind, Prisma } from '@prisma/client';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { EXPENSE_CATEGORIES } from '../expenses/expense-categories';
import { nairobiDayOf } from '../reports/profit.util';
import { dayOf, LedgerBooksService } from './ledger-books.service';
import {
  billCreditDraft,
  billDraft,
  billPaymentDraft,
  cancelFeeDraft,
  Draft,
  expenseDraft,
  fingerprint,
  folioMoneyDraft,
  layawayCompleteDraft,
  layawayPaymentDraft,
  payrollDraft,
  postingDate,
  provisionDraft,
  refundDraft,
  rentInvoiceDraft,
  rentPaymentDraft,
  reversed,
  saleDraft,
  saleTaxCents,
  schoolReceiptDraft,
  toCents,
  wasteDraft,
  writeOffDraft,
} from './ledger-posting.util';

const BATCH = 200;
const MAX_ROUNDS = 50;
const NAIROBI_OFFSET_MS = 3 * 3600_000; // Kenya keeps UTC+3 all year
const short = (id: string) => id.slice(0, 8);

interface Ctx {
  /** The start day as stored (UTC midnight), for comparing with date-only fields. */
  start: Date;
  startDay: string;
  /** The first instant of the start day in Nairobi, for comparing with times. */
  startAt: Date;
  /** The same two, ready for raw SQL: a time column (stored as UTC) and a date column. Compared as text casts, so the database's own time zone never shifts them. */
  since: Prisma.Sql;
  sinceDay: Prisma.Sql;
  lock: string | null;
  payrollPaidFrom: string;
}

/** A kind of thing that is posted: which ones need (re)posting now, and what each one should say in the books (null: nothing). */
interface Source {
  type: string;
  candidates: (tx: TenantTx, c: Ctx) => Promise<string[]>;
  draft: (tx: TenantTx, id: string, c: Ctx) => Promise<Draft | null>;
}

const ids = async (tx: TenantTx, q: Prisma.Sql): Promise<string[]> => (await tx.$queryRaw<{ id: string }[]>(q)).map((r) => r.id);
const unposted = (type: string) => Prisma.sql`NOT EXISTS (SELECT 1 FROM ledger_postings p WHERE p."sourceType" = ${type} AND p."sourceId" = t.id)`;
/** Sources already posted (with an entry standing) that now need another look. */
const postedWhere = (type: string, table: string, cond: Prisma.Sql) =>
  Prisma.sql`SELECT t.id FROM ledger_postings p JOIN ${Prisma.raw(`"${table}"`)} t ON t.id = p."sourceId" WHERE p."sourceType" = ${type} AND p."entryId" IS NOT NULL AND ${cond} LIMIT ${BATCH}`;
/** A follow-up (a bounce, a void) that is only posted when the original was. */
const originalPosted = (type: string) =>
  Prisma.sql`EXISTS (SELECT 1 FROM ledger_postings o WHERE o."sourceType" = ${type} AND o."sourceId" = t.id AND o."entryId" IS NOT NULL)`;
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Posts what happened in each business to its books, a batch at a time, in the background. Each source (a sale, an expense...)
 * has one posting row holding a fingerprint of its journal; when the source changes (a sale voided, an expense corrected, a bill
 * voided) the old entry is reversed and, if anything is still owed to the books, a new one is posted. A cheque that bounces, a
 * write-off put back and a rent payment voided are their own postings, dated the day they happened.
 */
@Injectable()
export class LedgerPosterService {
  private readonly logger = new Logger(LedgerPosterService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly books: LedgerBooksService,
  ) {}

  private readonly sources: Source[] = [
    {
      type: 'SALE',
      candidates: async (tx, c) => [
        ...(await ids(tx, Prisma.sql`SELECT t.id FROM sales t WHERE t.status::text = 'COMPLETED' AND t."createdAt" >= ${c.since} AND ${unposted('SALE')} ORDER BY t."createdAt" LIMIT ${BATCH}`)),
        ...(await ids(tx, postedWhere('SALE', 'sales', Prisma.sql`t.status::text = 'VOIDED'`))),
      ],
      draft: async (tx, id, c) => {
        const sale = await tx.sale.findUnique({
          where: { id },
          include: {
            lineItems: {
              select: {
                quantity: true,
                unitPrice: true,
                taxAmount: true,
                variant: { select: { cost: true } },
                ingredients: { select: { quantity: true, ingredientVariant: { select: { cost: true } } } },
              },
            },
            payments: { select: { method: true, amount: true } },
            roomSettlement: { select: { id: true } },
          },
        });
        if (!sale || sale.status !== 'COMPLETED' || sale.createdAt < c.startAt) return null;
        let cost = 0;
        for (const l of sale.lineItems) {
          if (l.ingredients.length > 0) {
            for (const i of l.ingredients) if (i.ingredientVariant.cost !== null) cost += Number(i.quantity) * Number(i.ingredientVariant.cost);
          } else if (l.variant.cost !== null) cost += Number(l.quantity) * Number(l.variant.cost);
        }
        return saleDraft({
          date: nairobiDayOf(sale.createdAt),
          branchId: sale.branchId,
          reference: short(sale.id),
          totalCents: toCents(sale.total),
          lines: sale.lineItems.map((l) => ({ netCents: toCents(Number(l.quantity) * Number(l.unitPrice)), taxCents: toCents(l.taxAmount) })),
          payments: sale.payments.map((p) => ({ method: p.method, amountCents: toCents(p.amount) })),
          costCents: Math.round(cost * 100),
          settlement: !!sale.roomSettlement,
        });
      },
    },
    {
      type: 'REFUND',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM refunds t WHERE t."createdAt" >= ${c.since} AND ${unposted('REFUND')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const r = await tx.refund.findUnique({
          where: { id },
          include: {
            sale: {
              include: {
                lineItems: { select: { quantity: true, unitPrice: true, taxAmount: true } },
                payments: { select: { method: true, amount: true } },
                roomSettlement: { select: { id: true } },
              },
            },
          },
        });
        if (!r) return null;
        const s = r.sale;
        const total = toCents(s.total);
        const main = [...s.payments].sort((a, b) => Number(b.amount) - Number(a.amount))[0]?.method ?? 'CASH';
        return refundDraft({
          date: nairobiDayOf(r.createdAt),
          branchId: s.branchId,
          reference: short(s.id),
          amountCents: toCents(r.amount),
          saleTotalCents: total,
          saleTaxCents: saleTaxCents(total, s.lineItems.map((l) => ({ netCents: toCents(Number(l.quantity) * Number(l.unitPrice)), taxCents: toCents(l.taxAmount) }))),
          mainMethod: main,
          settlement: !!s.roomSettlement,
        });
      },
    },
    {
      type: 'EXPENSE',
      candidates: async (tx, c) => [
        ...(await ids(tx, Prisma.sql`SELECT t.id FROM expenses t WHERE t."spentOn" >= ${c.sinceDay} AND ${unposted('EXPENSE')} ORDER BY t."createdAt" LIMIT ${BATCH}`)),
        ...(await ids(tx, Prisma.sql`SELECT t.id FROM ledger_postings p JOIN expenses t ON t.id = p."sourceId" WHERE p."sourceType" = 'EXPENSE' AND t."updatedAt" > p."updatedAt" LIMIT ${BATCH}`)),
        // deleted expenses: the posting is all that is left
        ...(await ids(
          tx,
          Prisma.sql`SELECT p."sourceId" AS id FROM ledger_postings p WHERE p."sourceType" = 'EXPENSE' AND p."entryId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = p."sourceId") LIMIT ${BATCH}`,
        )),
      ],
      draft: async (tx, id, c) => {
        const e = await tx.expense.findUnique({ where: { id } });
        if (!e || e.spentOn < c.start) return null;
        const label = EXPENSE_CATEGORIES.find((x) => x.key === e.category)?.label ?? e.category;
        return expenseDraft({
          date: dateKey(e.spentOn),
          branchId: e.branchId,
          category: e.category,
          label: e.description ? `${label} - ${e.description}` : label,
          amountCents: toCents(e.amount),
          paidWith: e.paidWith,
        });
      },
    },
    {
      type: 'BILL',
      candidates: async (tx, c) => [
        ...(await ids(tx, Prisma.sql`SELECT t.id FROM supplier_bills t WHERE t."billDate" >= ${c.sinceDay} AND t.status::text <> 'VOID' AND ${unposted('BILL')} ORDER BY t."createdAt" LIMIT ${BATCH}`)),
        ...(await ids(tx, postedWhere('BILL', 'supplier_bills', Prisma.sql`t.status::text = 'VOID'`))),
      ],
      draft: async (tx, id, c) => {
        const b = await tx.supplierBill.findUnique({ where: { id }, include: { supplier: { select: { name: true } } } });
        if (!b || b.status === 'VOID' || b.billDate < c.start) return null;
        return billDraft({ date: dateKey(b.billDate), reference: b.billNumber, supplier: b.supplier.name, totalCents: toCents(b.total) });
      },
    },
    {
      type: 'BILL_CREDIT',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM supplier_bill_credits t WHERE t."createdAt" >= ${c.since} AND ${unposted('BILL_CREDIT')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const r = await tx.supplierBillCredit.findUnique({ where: { id }, include: { bill: { include: { supplier: { select: { name: true } } } } } });
        if (!r) return null;
        return billCreditDraft({ date: nairobiDayOf(r.createdAt), reference: r.bill.billNumber, supplier: r.bill.supplier.name, amountCents: toCents(r.amount) });
      },
    },
    {
      type: 'BILL_PAYMENT',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM supplier_bill_payments t WHERE t."paidAt" >= ${c.since} AND ${unposted('BILL_PAYMENT')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const r = await tx.supplierBillPayment.findUnique({ where: { id }, include: { bill: { include: { supplier: { select: { name: true } } } } } });
        if (!r) return null;
        return billPaymentDraft({ date: nairobiDayOf(r.paidAt), reference: r.bill.billNumber, supplier: r.bill.supplier.name, amountCents: toCents(r.amount), method: r.method });
      },
    },
    {
      type: 'PAYROLL',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM payroll_runs t WHERE t.status::text = 'PAID' AND t."paidAt" >= ${c.since} AND ${unposted('PAYROLL')} ORDER BY t."paidAt" LIMIT ${BATCH}`),
      draft: async (tx, id, c) => {
        const run = await tx.payrollRun.findUnique({ where: { id }, include: { payslips: true } });
        if (!run || run.status !== 'PAID' || !run.paidAt) return null;
        const sum = (f: (p: (typeof run.payslips)[number]) => unknown) => run.payslips.reduce((s, p) => s + toCents(f(p)), 0);
        return payrollDraft({
          date: nairobiDayOf(run.paidAt),
          period: `${dateKey(run.periodStart)} to ${dateKey(run.periodEnd)}`,
          grossCents: sum((p) => p.grossPay),
          payeCents: sum((p) => p.payeTax),
          nssfCents: sum((p) => p.nssfDeduction),
          shifCents: sum((p) => p.shifDeduction),
          housingCents: sum((p) => p.housingLevy),
          netCents: sum((p) => p.netPay),
          paidFrom: c.payrollPaidFrom,
        });
      },
    },
    {
      type: 'SCHOOL_RECEIPT',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM supplier_payments t WHERE t."receivedOn" >= ${c.sinceDay} AND ${unposted('SCHOOL_RECEIPT')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const r = await tx.supplierPayment.findUnique({ where: { id }, include: { school: { select: { name: true } } } });
        if (!r) return null;
        return schoolReceiptDraft({ date: dateKey(r.receivedOn), reference: r.receiptNumber, school: r.school.name, amountCents: toCents(r.amount), method: r.method });
      },
    },
    {
      type: 'SCHOOL_BOUNCE',
      candidates: (tx) =>
        ids(tx, Prisma.sql`SELECT t.id FROM supplier_payments t WHERE t.status::text = 'BOUNCED' AND t."bouncedAt" IS NOT NULL AND ${originalPosted('SCHOOL_RECEIPT')} AND ${unposted('SCHOOL_BOUNCE')} LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const r = await tx.supplierPayment.findUnique({ where: { id } });
        if (!r || r.status !== 'BOUNCED' || !r.bouncedAt) return null;
        return this.undo(tx, 'SCHOOL_RECEIPT', id, nairobiDayOf(r.bouncedAt), `Cheque bounced: receipt ${r.receiptNumber}`);
      },
    },
    {
      type: 'WRITE_OFF',
      candidates: (tx, c) =>
        ids(tx, Prisma.sql`SELECT t.id FROM school_write_offs t WHERE t.status::text IN ('APPROVED', 'REVERSED') AND t."decidedAt" >= ${c.since} AND ${unposted('WRITE_OFF')} ORDER BY t."decidedAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const w = await tx.schoolWriteOff.findUnique({ where: { id }, include: { invoice: { select: { invoiceNumber: true } } } });
        if (!w || !w.decidedAt || (w.status !== 'APPROVED' && w.status !== 'REVERSED')) return null;
        return writeOffDraft({ date: nairobiDayOf(w.decidedAt), reference: w.invoice.invoiceNumber, amountCents: toCents(w.amount) });
      },
    },
    {
      type: 'WRITE_OFF_REVERSAL',
      candidates: (tx) =>
        ids(tx, Prisma.sql`SELECT t.id FROM school_write_offs t WHERE t.status::text = 'REVERSED' AND t."reversedAt" IS NOT NULL AND ${originalPosted('WRITE_OFF')} AND ${unposted('WRITE_OFF_REVERSAL')} LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const w = await tx.schoolWriteOff.findUnique({ where: { id }, include: { invoice: { select: { invoiceNumber: true } } } });
        if (!w || w.status !== 'REVERSED' || !w.reversedAt) return null;
        return this.undo(tx, 'WRITE_OFF', id, nairobiDayOf(w.reversedAt), `Write-off put back (${w.invoice.invoiceNumber})`);
      },
    },
    {
      type: 'PROVISION',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM school_provision_entries t WHERE t."createdAt" >= ${c.since} AND ${unposted('PROVISION')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id, c) => {
        const p = await tx.schoolProvisionEntry.findUnique({ where: { id } });
        if (!p) return null;
        const day = dateKey(p.asOf) < c.startDay ? c.startDay : dateKey(p.asOf);
        return provisionDraft({ date: day, changeCents: toCents(p.amount) - toCents(p.previous) });
      },
    },
    {
      type: 'RENT_INVOICE',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM rental_invoices t WHERE t."createdAt" >= ${c.since} AND ${unposted('RENT_INVOICE')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const r = await tx.rentalInvoice.findUnique({
          where: { id },
          include: { lease: { select: { unit: { select: { label: true } }, tenant: { select: { name: true } } } } },
        });
        if (!r) return null;
        const what = r.periodMonth ? dateKey(r.periodMonth).slice(0, 7) : (r.description ?? '');
        return rentInvoiceDraft({
          date: nairobiDayOf(r.createdAt),
          kind: r.kind,
          reference: `${r.lease.unit.label}, ${r.lease.tenant.name}${what ? `, ${what}` : ''}`,
          amountCents: toCents(r.amountDue),
        });
      },
    },
    {
      type: 'RENT_PAYMENT',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM rental_payments t WHERE t."paidAt" >= ${c.sinceDay} AND ${unposted('RENT_PAYMENT')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const r = await tx.rentalPayment.findUnique({ where: { id } });
        if (!r) return null;
        return rentPaymentDraft({ date: dateKey(r.paidAt), reference: r.receiptNumber, amountCents: toCents(r.amount), method: r.method });
      },
    },
    {
      type: 'RENT_PAYMENT_VOID',
      candidates: (tx) =>
        ids(tx, Prisma.sql`SELECT t.id FROM rental_payments t WHERE t."voidedAt" IS NOT NULL AND ${originalPosted('RENT_PAYMENT')} AND ${unposted('RENT_PAYMENT_VOID')} LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const r = await tx.rentalPayment.findUnique({ where: { id } });
        if (!r || !r.voidedAt) return null;
        return this.undo(tx, 'RENT_PAYMENT', id, nairobiDayOf(r.voidedAt), `Rent payment ${r.receiptNumber} voided`);
      },
    },
    {
      type: 'WASTE',
      candidates: (tx, c) =>
        ids(tx, Prisma.sql`SELECT t.id FROM waste_logs t WHERE t."totalCost" IS NOT NULL AND t."createdAt" >= ${c.since} AND ${unposted('WASTE')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const w = await tx.wasteLog.findUnique({ where: { id }, include: { variant: { select: { name: true, product: { select: { name: true } } } } } });
        if (!w || w.totalCost === null) return null;
        const item = [w.variant.product.name, w.variant.name].filter(Boolean).join(' ');
        return wasteDraft({ date: nairobiDayOf(w.createdAt), branchId: w.branchId, label: `${item} x ${Number(w.quantity)} (${w.reason.toLowerCase()})`, costCents: toCents(w.totalCost) });
      },
    },
    {
      type: 'LAYAWAY_PAYMENT',
      candidates: (tx, c) => ids(tx, Prisma.sql`SELECT t.id FROM layaway_payments t WHERE t."createdAt" >= ${c.since} AND ${unposted('LAYAWAY_PAYMENT')} ORDER BY t."createdAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const p = await tx.layawayPayment.findUnique({ where: { id }, include: { layaway: { include: { customer: { select: { name: true } } } } } });
        if (!p) return null;
        return layawayPaymentDraft({ date: nairobiDayOf(p.createdAt), branchId: p.layaway.branchId, reference: p.layaway.customer.name, amountCents: toCents(p.amount), method: p.method });
      },
    },
    {
      type: 'LAYAWAY_DONE',
      candidates: (tx, c) =>
        ids(tx, Prisma.sql`SELECT t.id FROM layaways t WHERE t.status::text = 'COMPLETED' AND t."completedAt" >= ${c.since} AND ${unposted('LAYAWAY_DONE')} ORDER BY t."completedAt" LIMIT ${BATCH}`),
      draft: async (tx, id) => {
        const l = await tx.layaway.findUnique({
          where: { id },
          include: { customer: { select: { name: true } }, lineItems: { include: { variant: { select: { cost: true } } } } },
        });
        if (!l || l.status !== 'COMPLETED' || !l.completedAt) return null;
        const cost = l.lineItems.reduce((s, i) => s + (i.variant.cost === null ? 0 : Number(i.quantity) * Number(i.variant.cost)), 0);
        return layawayCompleteDraft({
          date: nairobiDayOf(l.completedAt),
          branchId: l.branchId,
          reference: l.customer.name,
          totalCents: toCents(l.total),
          taxCents: l.lineItems.reduce((s, i) => s + toCents(i.taxAmount), 0),
          costCents: Math.round(cost * 100),
        });
      },
    },
    {
      type: 'FOLIO_MONEY',
      candidates: (tx, c) =>
        ids(
          tx,
          Prisma.sql`SELECT t.id FROM hotel_folio_entries t WHERE t.type::text IN ('PAYMENT', 'REFUND') AND t.method IS NOT NULL AND t."createdAt" >= ${c.since} AND ${unposted('FOLIO_MONEY')} ORDER BY t."createdAt" LIMIT ${BATCH}`,
        ),
      draft: async (tx, id) => {
        const e = await tx.hotelFolioEntry.findUnique({ where: { id }, include: { folio: { include: { booking: { select: { bookingNumber: true, guestName: true } } } } } });
        if (!e || !e.method || (e.type !== 'PAYMENT' && e.type !== 'REFUND')) return null;
        return folioMoneyDraft({
          date: nairobiDayOf(e.createdAt),
          reference: `${e.folio.booking.bookingNumber}, ${e.folio.booking.guestName}`,
          amountCents: toCents(e.amount),
          method: e.method,
          refund: e.type === 'REFUND',
        });
      },
    },
    {
      type: 'HOTEL_CANCEL_FEE',
      candidates: (tx, c) =>
        ids(
          tx,
          Prisma.sql`SELECT t.id FROM room_bookings t WHERE t.status::text IN ('CANCELLED', 'NO_SHOW') AND t."cancelFeeKept" > 0 AND t."cancelledAt" >= ${c.since} AND ${unposted('HOTEL_CANCEL_FEE')} ORDER BY t."cancelledAt" LIMIT ${BATCH}`,
        ),
      draft: async (tx, id) => {
        const b = await tx.roomBooking.findUnique({ where: { id }, select: { bookingNumber: true, guestName: true, cancelFeeKept: true, cancelledAt: true, status: true } });
        if (!b || !b.cancelledAt || !b.cancelFeeKept || (b.status !== 'CANCELLED' && b.status !== 'NO_SHOW')) return null;
        return cancelFeeDraft({ date: nairobiDayOf(b.cancelledAt), reference: `${b.bookingNumber}, ${b.guestName}`, feeCents: toCents(b.cancelFeeKept) });
      },
    },
  ];

  /** A follow-up that undoes exactly what the original posted (null when the original posted nothing). */
  private async undo(tx: TenantTx, originalType: string, id: string, date: string, memo: string): Promise<Draft | null> {
    const { organizationId } = getTenantStore();
    const original = await tx.ledgerPosting.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId, sourceType: originalType, sourceId: id } } });
    if (!original?.entryId) return null;
    return { date, memo, lines: reversed(await this.books.linesOf(tx, original.entryId)) };
  }

  /** Brings one source's posting up to date. Returns what was done. */
  private async apply(tx: TenantTx, source: Source, id: string, c: Ctx): Promise<'same' | 'posted' | 'reversed' | 'reposted'> {
    const { organizationId } = getTenantStore();
    const draft = await source.draft(tx, id, c);
    const wanted = draft && draft.lines.length > 0 ? draft : null;
    const fp = fingerprint(wanted);
    const key = { organizationId_sourceType_sourceId: { organizationId, sourceType: source.type, sourceId: id } };
    const existing = await tx.ledgerPosting.findUnique({ where: key });
    if (existing && existing.fingerprint === fp) {
      await tx.ledgerPosting.update({ where: { id: existing.id }, data: { fingerprint: fp } }); // marks it as looked at
      return 'same';
    }
    if (existing?.entryId) {
      const old = await tx.journalEntry.findUniqueOrThrow({ where: { id: existing.entryId } });
      await this.books.reverse(tx, old.id, postingDate(dayOf(old.entryDate)!, c.lock), `Undo: ${old.memo}`);
    }
    let entryId: string | null = null;
    if (wanted) {
      const entry = await this.books.write(tx, {
        date: postingDate(wanted.date, c.lock),
        kind: JournalKind.AUTO,
        memo: wanted.memo,
        sourceType: source.type,
        sourceId: id,
        branchId: wanted.branchId ?? null,
        lines: wanted.lines,
      });
      entryId = entry.id;
    }
    await tx.ledgerPosting.upsert({
      where: key,
      create: { organizationId, sourceType: source.type, sourceId: id, fingerprint: fp, entryId },
      update: { fingerprint: fp, entryId },
    });
    if (!existing) return 'posted';
    return wanted ? 'reposted' : 'reversed';
  }

  /** One pass for the current business. Each source is brought up to date in its own small transaction, so one problem never blocks the rest. */
  async runPass() {
    const result = { posted: 0, reposted: 0, reversed: 0, failed: 0 };
    let lastError: string | null = null;
    const c = await this.tenantPrisma.run(async (tx) => {
      const s = await this.books.settings(tx);
      const startDay = dayOf(s.startDate)!;
      const startAt = new Date(new Date(`${startDay}T00:00:00.000Z`).getTime() - NAIROBI_OFFSET_MS);
      return {
        start: s.startDate,
        startDay,
        startAt,
        since: Prisma.sql`${startAt.toISOString().replace('T', ' ').replace('Z', '')}::timestamp`,
        sinceDay: Prisma.sql`${startDay}::date`,
        lock: dayOf(s.lockDate),
        payrollPaidFrom: s.payrollPaidFrom,
      } satisfies Ctx;
    });
    for (const source of this.sources) {
      // a batch at a time until nothing is left (a business opening its books on old records may have thousands)
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let todo: string[];
        try {
          todo = [...new Set(await this.tenantPrisma.run((tx) => source.candidates(tx, c)))];
        } catch (e) {
          result.failed++;
          lastError = `${source.type}: ${(e as Error).message}`;
          this.logger.warn({ err: e, source: source.type }, 'Finding what to post failed');
          break;
        }
        let progress = 0;
        for (const id of todo) {
          try {
            const done = await this.tenantPrisma.run(async (tx) => {
              await this.books.lock(tx);
              return this.apply(tx, source, id, c);
            });
            progress++;
            if (done !== 'same') result[done]++;
          } catch (e) {
            result.failed++;
            lastError = `${source.type} ${short(id)}: ${(e as Error).message}`;
            this.logger.warn({ err: e, source: source.type, id }, 'Posting to the books failed');
          }
        }
        // a short batch was the last one; a batch where everything failed would only fail again
        if (todo.length < BATCH || progress === 0) break;
      }
    }
    await this.tenantPrisma.run((tx) =>
      tx.ledgerSettings.update({
        where: { organizationId: getTenantStore().organizationId },
        data: { lastPassAt: new Date(), ...(result.failed > 0 ? { lastPassNote: lastError?.slice(0, 500) } : result.posted + result.reposted + result.reversed > 0 ? { lastPassNote: null } : {}) },
      }),
    );
    return result;
  }
}
