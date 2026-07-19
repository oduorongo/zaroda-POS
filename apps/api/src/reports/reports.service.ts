import { Injectable } from '@nestjs/common';
import { SaleStatus } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { ReportFiltersDto } from './dto/report-filters.dto';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class ReportsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /** Only COMPLETED sales count toward any report - a VOIDED sale's revenue never happened. */
  private loadCompletedSales(tx: TenantTx, filters: ReportFiltersDto) {
    return tx.sale.findMany({
      where: {
        status: SaleStatus.COMPLETED,
        branchId: filters.branchId,
        createdAt: {
          gte: filters.from ? new Date(filters.from) : undefined,
          lt: filters.to ? new Date(filters.to) : undefined,
        },
      },
      include: {
        branch: { select: { name: true } },
        cashier: { include: { user: { select: { fullName: true } } } },
        lineItems: { include: { variant: { include: { product: true } } } },
      },
    });
  }

  async salesByProduct(filters: ReportFiltersDto) {
    const sales = await this.tenantPrisma.run((tx) =>
      this.loadCompletedSales(tx, filters),
    );

    const byVariant = new Map<
      string,
      {
        variantId: string;
        sku: string;
        productName: string;
        quantitySold: number;
        revenue: number;
        cost: number | null;
      }
    >();
    for (const sale of sales) {
      for (const line of sale.lineItems) {
        const key = line.variantId;
        const existing = byVariant.get(key) ?? {
          variantId: line.variantId,
          sku: line.variant.sku,
          productName: line.variant.product.name,
          quantitySold: 0,
          revenue: 0,
          cost: line.variant.cost === null ? null : 0,
        };
        existing.quantitySold += line.quantity;
        existing.revenue = round2(
          existing.revenue +
            Number(line.unitPrice) * line.quantity +
            Number(line.taxAmount),
        );
        if (existing.cost !== null && line.variant.cost !== null) {
          existing.cost = round2(
            existing.cost + Number(line.variant.cost) * line.quantity,
          );
        }
        byVariant.set(key, existing);
      }
    }

    return Array.from(byVariant.values())
      .map((row) => ({
        ...row,
        // Margin only computed where cost is actually known - see the
        // schema comment on ProductVariant.cost for why a missing cost
        // isn't treated as zero.
        margin: row.cost === null ? null : round2(row.revenue - row.cost),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  async salesByBranch(filters: ReportFiltersDto) {
    const sales = await this.tenantPrisma.run((tx) =>
      this.loadCompletedSales(tx, filters),
    );

    const byBranch = new Map<
      string,
      {
        branchId: string;
        branchName: string;
        saleCount: number;
        revenue: number;
      }
    >();
    for (const sale of sales) {
      const existing = byBranch.get(sale.branchId) ?? {
        branchId: sale.branchId,
        branchName: sale.branch.name,
        saleCount: 0,
        revenue: 0,
      };
      existing.saleCount += 1;
      existing.revenue = round2(existing.revenue + Number(sale.total));
      byBranch.set(sale.branchId, existing);
    }

    return Array.from(byBranch.values()).sort((a, b) => b.revenue - a.revenue);
  }

  async salesByCashier(filters: ReportFiltersDto) {
    const sales = await this.tenantPrisma.run((tx) =>
      this.loadCompletedSales(tx, filters),
    );

    const byCashier = new Map<
      string,
      {
        orgUserId: string;
        cashierName: string;
        saleCount: number;
        revenue: number;
      }
    >();
    for (const sale of sales) {
      const key = sale.cashierOrgUserId ?? 'unknown';
      const existing = byCashier.get(key) ?? {
        orgUserId: key,
        cashierName: sale.cashier?.user.fullName ?? 'Unknown',
        saleCount: 0,
        revenue: 0,
      };
      existing.saleCount += 1;
      existing.revenue = round2(existing.revenue + Number(sale.total));
      byCashier.set(key, existing);
    }

    return Array.from(byCashier.values()).sort((a, b) => b.revenue - a.revenue);
  }

  /**
   * Kenya is a single timezone with no DST (EAT, UTC+3) - DESIGN.md is
   * explicit about this being a Kenya-first product, so hour-of-day
   * bucketing converts from the timestamp's UTC storage rather than using
   * `Date.getHours()`, which would silently bucket by the *server's* local
   * timezone (almost certainly UTC in production) and misreport every
   * sale's hour by 3.
   */
  private eatHour(date: Date): number {
    return (date.getUTCHours() + 3) % 24;
  }

  async salesByHour(filters: ReportFiltersDto) {
    const sales = await this.tenantPrisma.run((tx) =>
      this.loadCompletedSales(tx, filters),
    );

    const byHour = new Map<
      number,
      { hour: number; saleCount: number; revenue: number }
    >();
    for (let h = 0; h < 24; h++)
      byHour.set(h, { hour: h, saleCount: 0, revenue: 0 });
    for (const sale of sales) {
      const existing = byHour.get(this.eatHour(sale.createdAt))!;
      existing.saleCount += 1;
      existing.revenue = round2(existing.revenue + Number(sale.total));
    }

    return Array.from(byHour.values());
  }
}
