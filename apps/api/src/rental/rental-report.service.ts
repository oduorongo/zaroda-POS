import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { fromCents, nairobiToday, toCents } from './rental-billing.util';

/** The landlord's monthly picture: what came in, what went out, who is behind, and how full the buildings are. */
@Injectable()
export class RentalReportService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /** `month` is YYYY-MM; defaults to the current month in Nairobi. */
  async monthly(month?: string) {
    const { organizationId } = getTenantStore();
    const today = nairobiToday();
    const key = month ?? today.toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new BadRequestException('Month must look like 2026-10');
    const from = new Date(`${key}-01T00:00:00.000Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)); // last day of the month

    return this.tenantPrisma.run(async (tx) => {
      const [properties, units, invoices, payments, expenses, org] = await Promise.all([
        tx.rentalProperty.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        tx.rentalUnit.findMany({ select: { id: true, propertyId: true, status: true } }),
        tx.rentalInvoice.findMany({ include: { lease: { select: { unit: { select: { propertyId: true } } } } } }),
        tx.rentalPayment.findMany({
          where: { voidedAt: null, paidAt: { gte: from, lte: to } },
          include: { lease: { select: { unit: { select: { propertyId: true } } } } },
        }),
        tx.rentalExpense.findMany({ where: { incurredAt: { gte: from, lte: to } } }),
        tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      ]);

      const rows = properties.map((p) => {
        const mine = units.filter((u) => u.propertyId === p.id);
        let charged = 0;
        let arrears = 0;
        for (const inv of invoices) {
          if (inv.lease.unit.propertyId !== p.id) continue;
          const owed = toCents(inv.amountDue) - toCents(inv.amountPaid);
          if (inv.kind !== 'DEPOSIT' && inv.dueDate >= from && inv.dueDate <= to) charged += toCents(inv.amountDue);
          if (owed > 0 && inv.dueDate < today) arrears += owed;
        }
        const collected = payments.filter((x) => x.lease.unit.propertyId === p.id).reduce((s, x) => s + toCents(x.amount), 0);
        const spent = expenses.filter((e) => e.propertyId === p.id).reduce((s, e) => s + toCents(e.amount), 0);
        return {
          propertyId: p.id,
          property: p.name,
          units: mine.length,
          occupied: mine.filter((u) => u.status === 'OCCUPIED').length,
          charged: fromCents(charged),
          collected: fromCents(collected),
          expenses: fromCents(spent),
          net: fromCents(collected - spent),
          arrears: fromCents(arrears),
        };
      });

      const sum = (pick: (r: (typeof rows)[number]) => number) => fromCents(rows.reduce((s, r) => s + toCents(pick(r)), 0));
      const byCategory = new Map<string, number>();
      for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + toCents(e.amount));

      return {
        business: org?.name ?? '',
        month: key,
        from,
        to,
        properties: rows,
        totals: {
          units: rows.reduce((s, r) => s + r.units, 0),
          occupied: rows.reduce((s, r) => s + r.occupied, 0),
          charged: sum((r) => r.charged),
          collected: sum((r) => r.collected),
          expenses: sum((r) => r.expenses),
          net: sum((r) => r.net),
          arrears: sum((r) => r.arrears),
        },
        expensesByCategory: [...byCategory.entries()].map(([category, cents]) => ({ category, amount: fromCents(cents) })),
        printedOn: today,
      };
    });
  }
}
