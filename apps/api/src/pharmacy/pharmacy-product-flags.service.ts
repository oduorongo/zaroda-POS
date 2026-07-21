import { Injectable, NotFoundException } from '@nestjs/common';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { SetProductFlagDto } from './dto/set-product-flag.dto';

@Injectable()
export class PharmacyProductFlagsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async setFlag(productId: string, dto: SetProductFlagDto) {
    return this.tenantPrisma.run(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException('Product not found');

      return tx.pharmacyProductFlag.upsert({
        where: { productId },
        create: {
          productId,
          isControlledSubstance: dto.isControlledSubstance,
          schedule: dto.schedule,
        },
        update: {
          isControlledSubstance: dto.isControlledSubstance,
          schedule: dto.schedule,
        },
      });
    });
  }

  async findOne(productId: string) {
    return this.tenantPrisma.run((tx) =>
      tx.pharmacyProductFlag.findUnique({ where: { productId } }),
    );
  }

  /**
   * Every product with its flag, if any (a product with no
   * PharmacyProductFlag row is simply "not flagged" - not an error, most
   * products in a pharmacy's catalog are plain over-the-counter items).
   * Powers the back office's Pharmacy screen, which needed a way to see
   * the whole catalog's controlled-substance status at once; nothing
   * before this listed more than one product's flag per request.
   */
  async findAllWithProducts() {
    return this.tenantPrisma.run(async (tx) => {
      const [products, flags] = await Promise.all([
        tx.product.findMany({ orderBy: { name: 'asc' } }),
        tx.pharmacyProductFlag.findMany(),
      ]);
      const flagByProductId = new Map(flags.map((f) => [f.productId, f]));
      return products.map((product) => ({
        ...product,
        pharmacyFlag: flagByProductId.get(product.id) ?? null,
      }));
    });
  }

  /** For PharmacySalesService, which needs to check flags for several products within its own transaction. */
  findManyInTx(tx: TenantTx, productIds: string[]) {
    return tx.pharmacyProductFlag.findMany({
      where: { productId: { in: productIds }, isControlledSubstance: true },
    });
  }
}
