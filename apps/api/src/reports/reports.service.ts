import { Injectable } from '@nestjs/common';
import { SaleStatus, WasteReason } from '@prisma/client';
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
        lineItems: {
          include: {
            variant: { include: { product: true } },
            // Recipe-tracked lines carry no cost of their own (see the
            // schema comment on RecipeIngredient - the dish's own stock/
            // cost never moves) - their cost is derived below from what
            // was actually consumed (SaleLineItemIngredient, snapshotted
            // at sale time so it survives a later recipe edit) priced at
            // each ingredient's CURRENT cost, same "not a historical
            // snapshot" convention this report already applies to a plain
            // variant's own cost.
            ingredients: { include: { ingredientVariant: true } },
          },
        },
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
        const isRecipeLine = line.ingredients.length > 0;
        // Unknown (not zero) cost propagates the same way a missing
        // ProductVariant.cost does elsewhere in this report - a recipe
        // with even one ingredient that has no cost set makes the whole
        // line's cost (and therefore this variant's margin) unknown
        // rather than silently understated.
        const lineCostKnown = isRecipeLine
          ? line.ingredients.every((i) => i.ingredientVariant.cost !== null)
          : line.variant.cost !== null;

        const existing = byVariant.get(key) ?? {
          variantId: line.variantId,
          sku: line.variant.sku,
          productName: line.variant.product.name,
          quantitySold: 0,
          revenue: 0,
          cost: lineCostKnown ? 0 : null,
        };
        const quantity = Number(line.quantity);
        existing.quantitySold += quantity;
        existing.revenue = round2(
          existing.revenue +
            Number(line.unitPrice) * quantity +
            Number(line.taxAmount),
        );
        if (existing.cost !== null) {
          if (!lineCostKnown) {
            existing.cost = null;
          } else {
            const lineCost = isRecipeLine
              ? line.ingredients.reduce(
                  (sum, i) =>
                    sum + Number(i.quantity) * Number(i.ingredientVariant.cost),
                  0,
                )
              : Number(line.variant.cost) * quantity;
            existing.cost = round2(existing.cost + lineCost);
          }
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

  /**
   * Cost of stock actually thrown away, by product - the counterpart to
   * salesByProduct's margin, so "what did we lose" is as visible as "what
   * did we make". Every WasteLog row already has unitCost/totalCost
   * snapshotted at write-off time (see that model's schema comment), so
   * this is a straight aggregation, not a re-derivation - unlike
   * salesByProduct, a single unknown-cost entry only makes that OTHER
   * entry's total unknown, not the whole variant's, since cost is
   * snapshotted per row rather than computed live from current data here.
   */
  async wasteByProduct(filters: ReportFiltersDto) {
    const logs = await this.tenantPrisma.run((tx) =>
      tx.wasteLog.findMany({
        where: {
          branchId: filters.branchId,
          createdAt: {
            gte: filters.from ? new Date(filters.from) : undefined,
            lt: filters.to ? new Date(filters.to) : undefined,
          },
        },
        include: { variant: { include: { product: true } } },
      }),
    );

    const byVariant = new Map<
      string,
      {
        variantId: string;
        sku: string;
        productName: string;
        quantityWasted: number;
        totalCost: number | null;
        entryCount: number;
        costUnknownEntries: number;
        byReason: Record<WasteReason, number>;
      }
    >();
    const zeroByReason = (): Record<WasteReason, number> => ({
      EXPIRED: 0,
      DAMAGED: 0,
      SPOILED: 0,
      OVERPRODUCTION: 0,
      OTHER: 0,
    });

    for (const log of logs) {
      const existing = byVariant.get(log.variantId) ?? {
        variantId: log.variantId,
        sku: log.variant.sku,
        productName: log.variant.product.name,
        quantityWasted: 0,
        totalCost: 0,
        entryCount: 0,
        costUnknownEntries: 0,
        byReason: zeroByReason(),
      };
      const quantity = Number(log.quantity);
      existing.entryCount += 1;
      existing.quantityWasted += quantity;
      existing.byReason[log.reason] += quantity;
      if (log.totalCost === null) {
        existing.costUnknownEntries += 1;
      } else if (existing.totalCost !== null) {
        existing.totalCost = round2(existing.totalCost + Number(log.totalCost));
      }
      byVariant.set(log.variantId, existing);
    }

    return Array.from(byVariant.values())
      .map((row) => ({
        variantId: row.variantId,
        sku: row.sku,
        productName: row.productName,
        quantityWasted: row.quantityWasted,
        // Partially-known cost is still shown, with a flag - a single
        // undated legacy entry shouldn't hide an otherwise-accurate total
        // the way salesByProduct's live-recomputed margin needs to.
        totalCost: row.costUnknownEntries === row.entryCount ? null : row.totalCost,
        costPartiallyKnown: row.costUnknownEntries > 0,
        byReason: row.byReason,
      }))
      .sort((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0));
  }
}
