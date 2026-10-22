import { BadRequestException, Injectable } from '@nestjs/common';
import { PayrollRunStatus, SaleStatus, SupplierInvoiceStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { EXPENSE_CATEGORIES } from '../expenses/expense-categories';
import { ProfitQueryDto } from './dto/profit-query.dto';
import { bucketKey, dayStart, defaultGroupBy, GroupBy, listBuckets, nairobiDayOf, rangeProblem, addDays } from './profit.util';

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Totals {
  saleCount: number;
  /** What customers paid (after discounts, tax included). */
  sales: number;
  /** Tax inside that money - it is the government's, not the business's. */
  tax: number;
  refunds: number;
  /** Cost of the goods that were sold (only where the cost is known). */
  costOfGoods: number;
  waste: number;
  expenses: number;
  /** Salaries paid through the Payroll screen. */
  payroll: number;
}

const empty = (): Totals => ({ saleCount: 0, sales: 0, tax: 0, refunds: 0, costOfGoods: 0, waste: 0, expenses: 0, payroll: 0 });

/** Derived money lines for a set of totals. */
function finish(t: Totals) {
  const netSales = t.sales - t.tax - t.refunds;
  const grossProfit = netSales - t.costOfGoods;
  const netProfit = grossProfit - t.waste - t.expenses - t.payroll;
  return {
    saleCount: t.saleCount,
    sales: round2(t.sales),
    tax: round2(t.tax),
    refunds: round2(t.refunds),
    netSales: round2(netSales),
    costOfGoods: round2(t.costOfGoods),
    grossProfit: round2(grossProfit),
    waste: round2(t.waste),
    expenses: round2(t.expenses),
    payroll: round2(t.payroll),
    netProfit: round2(netProfit),
  };
}

/**
 * Profit and loss for a period, by day, week or month (Nairobi time, weeks Monday-Sunday):
 *
 *   what customers paid, less the tax in it and any refunds        = net sales
 *   net sales less the cost of what was sold                       = gross profit (the margin)
 *   gross profit less waste, recorded expenses and payroll         = net profit
 *
 * Cost uses each product's cost as it is TODAY (the same convention as the product margin report) and only where a cost has
 * been entered; sales of products with no cost are counted in `unknownCostLines` so the screen can say that profit is
 * overstated by that much. Buying stock is not subtracted: it is already in the cost of what was sold.
 */
@Injectable()
export class ProfitService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async profit(query: ProfitQueryDto) {
    const problem = rangeProblem(query.from, query.to);
    if (problem) throw new BadRequestException(problem);
    const groupBy: GroupBy = query.groupBy ?? defaultGroupBy(query.from, query.to);
    const start = dayStart(query.from);
    const end = dayStart(addDays(query.to, 1)); // exclusive
    const branchId = query.branchId;

    const data = await this.tenantPrisma.run(async (tx) => {
      const [sales, refunds, wastes, expenses, payrollRuns, schoolInvoices] = await Promise.all([
        tx.sale.findMany({
          where: { status: SaleStatus.COMPLETED, branchId, createdAt: { gte: start, lt: end } },
          select: {
            createdAt: true,
            total: true,
            lineItems: {
              select: {
                quantity: true,
                taxAmount: true,
                variant: { select: { cost: true } },
                // Recipe dishes carry no cost of their own: it is what was actually used, priced at today's cost.
                ingredients: { select: { quantity: true, ingredientVariant: { select: { cost: true } } } },
              },
            },
          },
        }),
        tx.refund.findMany({ where: { createdAt: { gte: start, lt: end }, sale: branchId ? { branchId } : undefined }, select: { amount: true, createdAt: true } }),
        tx.wasteLog.findMany({ where: { branchId, createdAt: { gte: start, lt: end } }, select: { totalCost: true, createdAt: true } }),
        tx.expense.findMany({ where: { branchId, spentOn: { gte: new Date(`${query.from}T00:00:00.000Z`), lte: new Date(`${query.to}T00:00:00.000Z`) } }, select: { spentOn: true, amount: true, category: true } }),
        // Payroll is business-wide, so it is left out when looking at a single branch.
        branchId
          ? Promise.resolve([])
          : tx.payrollRun.findMany({ where: { status: PayrollRunStatus.PAID, paidAt: { gte: start, lt: end } }, select: { paidAt: true, payslips: { select: { grossPay: true } } } }),
        // Invoices to schools (credit sales) count on the day they are issued, not when they are paid. They belong to no branch.
        branchId
          ? Promise.resolve([])
          : tx.supplierInvoice.findMany({
              where: { status: { not: SupplierInvoiceStatus.VOID }, issueDate: { gte: new Date(`${query.from}T00:00:00.000Z`), lte: new Date(`${query.to}T00:00:00.000Z`) } },
              select: { issueDate: true, total: true, taxAmount: true, lines: { select: { quantity: true, unitCost: true } } },
            }),
      ]);
      // Stock buying: shown beside the profit, NOT taken off it (the cost of stock reaches profit when it is sold).
      const [billed, paidOut, owing] = branchId
        ? [[], [], []]
        : await Promise.all([
            tx.supplierBill.findMany({ where: { status: { not: 'VOID' }, billDate: { gte: new Date(`${query.from}T00:00:00.000Z`), lte: new Date(`${query.to}T00:00:00.000Z`) } }, select: { total: true, creditAmount: true } }),
            tx.supplierBillPayment.findMany({ where: { paidAt: { gte: start, lt: end } }, select: { amount: true } }),
            tx.supplierBill.findMany({ where: { status: { in: ['OPEN', 'PARTLY_PAID'] } }, select: { total: true, creditAmount: true, amountPaid: true } }),
          ]);
      return { sales, refunds, wastes, expenses, payrollRuns, schoolInvoices, billed, paidOut, owing };
    });

    const buckets = new Map<string, Totals>(listBuckets(query.from, query.to, groupBy).map((key) => [key, empty()]));
    const total = empty();
    const add = (day: string, apply: (t: Totals) => void) => {
      apply(total);
      const bucket = buckets.get(bucketKey(day, groupBy));
      if (bucket) apply(bucket);
    };

    let unknownCostLines = 0;
    let knownCostLines = 0;
    for (const sale of data.sales) {
      let saleTax = 0;
      let saleCost = 0;
      for (const line of sale.lineItems) {
        saleTax += Number(line.taxAmount);
        const isRecipe = line.ingredients.length > 0;
        const known = isRecipe ? line.ingredients.every((i) => i.ingredientVariant.cost !== null) : line.variant.cost !== null;
        if (!known) {
          unknownCostLines++;
          continue;
        }
        knownCostLines++;
        saleCost += isRecipe
          ? line.ingredients.reduce((sum, i) => sum + Number(i.quantity) * Number(i.ingredientVariant.cost), 0)
          : Number(line.variant.cost) * Number(line.quantity);
      }
      add(nairobiDayOf(sale.createdAt), (t) => {
        t.saleCount += 1;
        t.sales += Number(sale.total);
        t.tax += saleTax;
        t.costOfGoods += saleCost;
      });
    }
    for (const invoice of data.schoolInvoices) {
      let cost = 0;
      for (const line of invoice.lines) {
        if (line.unitCost === null) {
          unknownCostLines++;
          continue;
        }
        knownCostLines++;
        cost += Number(line.unitCost) * Number(line.quantity);
      }
      add(invoice.issueDate.toISOString().slice(0, 10), (t) => {
        t.saleCount += 1;
        t.sales += Number(invoice.total);
        t.tax += Number(invoice.taxAmount);
        t.costOfGoods += cost;
      });
    }
    for (const r of data.refunds) add(nairobiDayOf(r.createdAt), (t) => (t.refunds += Number(r.amount)));
    for (const w of data.wastes) if (w.totalCost !== null) add(nairobiDayOf(w.createdAt), (t) => (t.waste += Number(w.totalCost)));
    const byCategory = new Map<string, number>();
    for (const e of data.expenses) {
      add(e.spentOn.toISOString().slice(0, 10), (t) => (t.expenses += Number(e.amount)));
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));
    }
    for (const run of data.payrollRuns) {
      const gross = run.payslips.reduce((sum, p) => sum + Number(p.grossPay), 0);
      if (run.paidAt) add(nairobiDayOf(run.paidAt), (t) => (t.payroll += gross));
    }

    return {
      from: query.from,
      to: query.to,
      groupBy,
      branchId: branchId ?? null,
      totals: finish(total),
      // What was bought from suppliers in the period, what was paid out, and what is owed now. Information only: not in the profit.
      stockBuying: branchId
        ? null
        : {
            billed: round2(data.billed.reduce((s, b) => s + Number(b.total) - Number(b.creditAmount), 0)),
            paidToSuppliers: round2(data.paidOut.reduce((s, p) => s + Number(p.amount), 0)),
            owedNow: round2(data.owing.reduce((s, b) => s + Number(b.total) - Number(b.creditAmount) - Number(b.amountPaid), 0)),
          },
      periods: Array.from(buckets.entries()).map(([key, t]) => ({ key, ...finish(t) })),
      expensesByCategory: Array.from(byCategory.entries())
        .map(([category, amount]) => ({ category, label: EXPENSE_CATEGORIES.find((c) => c.key === category)?.label ?? category, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount),
      // Sales lines of products whose cost has not been entered: their profit is not reduced by any cost.
      unknownCostLines,
      knownCostLines,
      costNote:
        unknownCostLines > 0
          ? `${unknownCostLines} sold ${unknownCostLines === 1 ? 'item has' : 'items have'} no cost entered, so the profit shown is higher than the truth. Enter each product's cost on the Products screen.`
          : null,
    };
  }
}
