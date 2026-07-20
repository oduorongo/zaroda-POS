import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { SalesService } from '../sales/sales.service';
import { PharmacyProductFlagsService } from './pharmacy-product-flags.service';
import { CreatePharmacySaleDto } from './dto/create-pharmacy-sale.dto';

@Injectable()
export class PharmacySalesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly sales: SalesService,
    private readonly productFlags: PharmacyProductFlagsService,
  ) {}

  /**
   * A controlled-substance line requires prescription info to be
   * validated BEFORE calling SalesService.create(), not checked
   * afterward via a hook - Phase 4's restaurant module already found and
   * documented why: a hook fires before this module's own extension row
   * would exist, so it can't see synchronous data its own caller hasn't
   * written yet. Same reasoning applies here in reverse - a hook also
   * can't retroactively stop a sale that's already committed, so the
   * check has to happen up front, the same fix already applied to the
   * restaurant module's station validation after it caught a real "sale
   * completed but produced nothing useful" bug there.
   *
   * Not atomic across steps (complete the sale -> link the prescription)
   * for the same reason and with the same accepted risk as the
   * restaurant module's table link: SalesService.create() always commits
   * its own transaction first. The sale itself is never at risk; only
   * the prescription-linkage record is cheap to reconcile if a crash
   * lands between the two steps.
   */
  async createWithPrescription(dto: CreatePharmacySaleDto) {
    const variantIds = dto.lineItems.map((li) => li.variantId);
    const controlled = await this.tenantPrisma.run(async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: { product: true },
      });
      const productIds = [...new Set(variants.map((v) => v.productId))];
      const flags = await this.productFlags.findManyInTx(tx, productIds);
      const flaggedProductIds = new Set(flags.map((f) => f.productId));
      return variants
        .filter((v) => flaggedProductIds.has(v.productId))
        .map((v) => v.product.name);
    });

    if (controlled.length > 0 && !dto.prescription) {
      throw new BadRequestException(
        `Prescription required - this sale includes controlled substance(s): ${controlled.join(', ')}`,
      );
    }

    const sale = await this.sales.create({
      clientId: dto.clientId,
      branchId: dto.branchId,
      terminalId: dto.terminalId,
      cashierSessionId: dto.cashierSessionId,
      shiftId: dto.shiftId,
      lineItems: dto.lineItems,
      payments: dto.payments,
      discount: dto.discount,
      customerId: dto.customerId,
      redeemPoints: dto.redeemPoints,
    });

    if (!dto.prescription) return { sale, prescription: null };

    const prescription = await this.tenantPrisma.run(async (tx) => {
      // Idempotent the same way the sale itself is - a retried submission
      // with the same clientId resolves to the same sale above, and this
      // just confirms the link already exists rather than violating the
      // unique constraint on saleId trying to recreate it.
      const existing = await tx.pharmacySalePrescription.findUnique({
        where: { saleId: sale.id },
      });
      if (existing) return existing;

      return tx.pharmacySalePrescription.create({
        data: {
          saleId: sale.id,
          prescriptionNumber: dto.prescription!.prescriptionNumber,
          prescriberName: dto.prescription!.prescriberName,
          issuedDate: new Date(dto.prescription!.issuedDate),
        },
      });
    });

    return { sale, prescription };
  }
}
