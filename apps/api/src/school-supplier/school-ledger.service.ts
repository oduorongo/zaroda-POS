import { Injectable } from '@nestjs/common';
import { SupplierInvoiceStatus, SupplierPaymentStatus } from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { invoiceSurplus } from './school-credit.util';
import {
  AgeBucket,
  ageBucket,
  fromCents,
  toCents,
  todayKey,
} from './school-money.util';

const OPEN: SupplierInvoiceStatus[] = [
  SupplierInvoiceStatus.ISSUED,
  SupplierInvoiceStatus.PARTIALLY_PAID,
];
const day = (d: Date) => d.toISOString().slice(0, 10);

export interface SchoolBalance {
  /** What the school still owes on open invoices. */
  owed: number;
  /** The part of that which is past its due date. */
  overdue: number;
  /** Money received and not yet used against an invoice. */
  credit: number;
  openInvoices: number;
  ageing: Record<AgeBucket, number>;
}

const emptyAgeing = (): Record<AgeBucket, number> => ({
  CURRENT: 0,
  DAYS_1_30: 0,
  DAYS_31_60: 0,
  DAYS_61_90: 0,
  OVER_90: 0,
});

/** What each school owes and has paid, worked out from invoices, payments and the allocations between them. */
@Injectable()
export class SchoolLedgerService {
  /** Balances for the given schools (or all of the business's schools). */
  async balances(
    tx: TenantTx,
    schoolIds?: string[],
  ): Promise<Map<string, SchoolBalance>> {
    const today = todayKey();
    const [invoices, credited, payments] = await Promise.all([
      tx.supplierInvoice.findMany({
        where: {
          status: { in: OPEN },
          ...(schoolIds ? { schoolId: { in: schoolIds } } : {}),
        },
        select: {
          schoolId: true,
          total: true,
          amountPaid: true,
          creditAmount: true,
          dueDate: true,
        },
      }),
      // invoices that have been credited: if payments and credit notes together came to more than the invoice, the excess is the school's credit
      tx.supplierInvoice.findMany({
        where: {
          creditAmount: { gt: 0 },
          status: { not: SupplierInvoiceStatus.VOID },
          ...(schoolIds ? { schoolId: { in: schoolIds } } : {}),
        },
        select: {
          schoolId: true,
          total: true,
          amountPaid: true,
          creditAmount: true,
        },
      }),
      tx.supplierPayment.findMany({
        where: {
          status: SupplierPaymentStatus.RECEIVED,
          ...(schoolIds ? { schoolId: { in: schoolIds } } : {}),
        },
        select: {
          schoolId: true,
          amount: true,
          allocations: { select: { amount: true } },
        },
      }),
    ]);
    const out = new Map<string, SchoolBalance>();
    const get = (id: string) => {
      let b = out.get(id);
      if (!b) {
        b = {
          owed: 0,
          overdue: 0,
          credit: 0,
          openInvoices: 0,
          ageing: emptyAgeing(),
        };
        out.set(id, b);
      }
      return b;
    };
    for (const inv of invoices) {
      const b = get(inv.schoolId);
      const balance =
        toCents(inv.total) -
        toCents(inv.amountPaid) -
        toCents(inv.creditAmount);
      if (balance <= 0) continue;
      b.owed += balance;
      b.openInvoices += 1;
      const bucket = ageBucket(day(inv.dueDate), today);
      b.ageing[bucket] += balance;
      if (bucket !== 'CURRENT') b.overdue += balance;
    }
    for (const inv of credited) {
      const surplus = toCents(
        invoiceSurplus(
          Number(inv.total),
          Number(inv.amountPaid),
          Number(inv.creditAmount),
        ),
      );
      if (surplus > 0) get(inv.schoolId).credit += surplus;
    }
    for (const pay of payments) {
      const b = get(pay.schoolId);
      b.credit +=
        toCents(pay.amount) -
        pay.allocations.reduce((sum, a) => sum + toCents(a.amount), 0);
    }
    // back to shillings
    for (const b of Array.from(out.values())) {
      b.owed = fromCents(b.owed);
      b.overdue = fromCents(b.overdue);
      b.credit = fromCents(b.credit);
      for (const k of Object.keys(b.ageing) as AgeBucket[])
        b.ageing[k] = fromCents(b.ageing[k]);
    }
    return out;
  }

  /** The invoices of one school that still owe something, with how much. */
  async openInvoices(tx: TenantTx, schoolId: string) {
    const rows = await tx.supplierInvoice.findMany({
      where: { schoolId, status: { in: OPEN } },
      orderBy: [{ issueDate: 'asc' }, { invoiceNumber: 'asc' }],
    });
    return rows
      .map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        issueDate: day(r.issueDate),
        dueDate: day(r.dueDate),
        total: Number(r.total),
        balance: fromCents(
          toCents(r.total) - toCents(r.amountPaid) - toCents(r.creditAmount),
        ),
      }))
      .filter((r) => r.balance > 0);
  }

  /**
   * A school's statement: every invoice (a charge) and every payment received (a credit) in date order with a running
   * balance, and the balance brought forward from before the period. Voided invoices and bounced cheques are left out - they
   * never happened as far as the school's account is concerned.
   */
  async statement(tx: TenantTx, schoolId: string, from?: string, to?: string) {
    const [invoices, creditNotes, payments] = await Promise.all([
      tx.supplierInvoice.findMany({
        where: { schoolId, status: { not: SupplierInvoiceStatus.VOID } },
        orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.supplierCreditNote.findMany({
        where: { schoolId, invoice: { status: { not: SupplierInvoiceStatus.VOID } } },
        include: { invoice: { select: { invoiceNumber: true } } },
        orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.supplierPayment.findMany({
        where: { schoolId, status: SupplierPaymentStatus.RECEIVED },
        orderBy: [{ receivedOn: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    type Entry = {
      date: string;
      kind: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE';
      reference: string;
      description: string;
      debit: number;
      credit: number;
      at: number;
    };
    const all: Entry[] = [
      ...invoices.map((i) => ({
        date: day(i.issueDate),
        kind: 'INVOICE' as const,
        reference: i.invoiceNumber,
        description: `Invoice, due ${day(i.dueDate)}`,
        debit: Number(i.total),
        credit: 0,
        at: i.createdAt.getTime(),
      })),
      ...creditNotes.map((c) => ({
        date: day(c.issueDate),
        kind: 'CREDIT_NOTE' as const,
        reference: c.creditNumber,
        description: `Credit note against ${c.invoice.invoiceNumber}`,
        debit: 0,
        credit: Number(c.total),
        at: c.createdAt.getTime(),
      })),
      ...payments.map((p) => ({
        date: day(p.receivedOn),
        kind: 'PAYMENT' as const,
        reference: p.receiptNumber,
        description:
          p.method === 'WITHHOLDING_TAX'
            ? `Tax withheld by the school${p.whtCertificateNumber ? `, certificate ${p.whtCertificateNumber}` : ''}`
            : `Payment by ${p.method === 'CHEQUE' ? 'cheque' : p.method === 'BANK_TRANSFER' ? 'bank transfer' : p.method === 'MPESA' ? 'M-Pesa' : 'cash'}${p.reference ? ` ${p.reference}` : ''}`,
        debit: 0,
        credit: Number(p.amount),
        at: p.createdAt.getTime(),
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);

    let running = 0;
    let opening = 0;
    const entries = [];
    for (const e of all) {
      running += toCents(e.debit) - toCents(e.credit);
      if (from && e.date < from) {
        opening = running;
        continue;
      }
      if (to && e.date > to) continue;
      entries.push({
        date: e.date,
        kind: e.kind,
        reference: e.reference,
        description: e.description,
        debit: e.debit,
        credit: e.credit,
        balance: fromCents(running),
      });
    }
    const closing =
      entries.length > 0
        ? entries[entries.length - 1].balance
        : fromCents(opening);
    return {
      openingBalance: fromCents(opening),
      closingBalance: closing,
      entries,
      from: from ?? null,
      to: to ?? null,
    };
  }
}
