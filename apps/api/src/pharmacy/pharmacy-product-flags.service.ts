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

  /** For PharmacySalesService, which needs to check flags for several products within its own transaction. */
  findManyInTx(tx: TenantTx, productIds: string[]) {
    return tx.pharmacyProductFlag.findMany({
      where: { productId: { in: productIds }, isControlledSubstance: true },
    });
  }
}
