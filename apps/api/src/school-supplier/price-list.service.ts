import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { variantTitle } from '../catalog/variant-title';
import { normalizeSlug } from '../online-store/online-store.constants';
import { SavePortalDto, SavePriceListDto } from './dto/school-supplier.dto';

const taxRateOf = (taxClass: { rate: unknown; isExempt: boolean } | null) =>
  taxClass && !taxClass.isExempt ? Number(taxClass.rate) : 0;

/**
 * The price list schools order from: which of the supplier's products are on it and what schools pay. A school price left
 * empty means the normal price. Prices are before VAT; VAT is added from the product's tax class when an order is placed.
 */
@Injectable()
export class PriceListService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /** Everything the supplier sells, so each item can be put on (or taken off) the list and priced. */
  async list() {
    const variants = await this.tenantPrisma.run((tx) =>
      tx.productVariant.findMany({
        include: {
          product: {
            select: {
              name: true,
              category: { select: { name: true } },
              taxClass: { select: { rate: true, isExempt: true } },
            },
          },
        },
        orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
        take: 5000,
      }),
    );
    return variants.map((v) => ({
      variantId: v.id,
      title: variantTitle(v.product.name, v.name),
      sku: v.sku,
      category: v.product.category?.name ?? null,
      price: Number(v.price),
      schoolPrice: v.schoolPrice === null ? null : Number(v.schoolPrice),
      onSchoolList: v.onSchoolList,
      cost: v.cost === null ? null : Number(v.cost),
      taxRate: taxRateOf(v.product.taxClass),
      quantityMode: v.quantityMode,
    }));
  }

  /** Saves a batch of changes (a whole page of the editor at a time). */
  async save(dto: SavePriceListDto) {
    return this.tenantPrisma.run(async (tx) => {
      const ids = Array.from(new Set(dto.entries.map((e) => e.variantId)));
      const found = await tx.productVariant.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      if (found.length !== ids.length)
        throw new BadRequestException('One of those products was not found');
      for (const e of dto.entries) {
        await tx.productVariant.update({
          where: { id: e.variantId },
          data: {
            onSchoolList: e.onSchoolList,
            schoolPrice:
              e.schoolPrice === undefined ? undefined : e.schoolPrice,
          },
        });
      }
      return { saved: dto.entries.length };
    });
  }

  // ── The portal's address ──────────────────────────────────────────────

  async getPortal() {
    const { organizationId } = getTenantStore();
    const portal = await this.tenantPrisma.run((tx) =>
      tx.schoolPortal.findUnique({ where: { organizationId } }),
    );
    return portal
      ? {
          slug: portal.slug,
          displayName: portal.displayName,
          enabled: portal.enabled,
        }
      : null;
  }

  async savePortal(dto: SavePortalDto) {
    const { organizationId } = getTenantStore();
    const slug = normalizeSlug(dto.slug);
    if (!slug)
      throw new BadRequestException(
        'The link name must be 3-40 letters, numbers or hyphens (for example: jaribu-stationers)',
      );
    try {
      const portal = await this.tenantPrisma.run((tx) =>
        tx.schoolPortal.upsert({
          where: { organizationId },
          create: {
            organizationId,
            slug,
            displayName: dto.displayName.trim(),
            enabled: dto.enabled ?? true,
          },
          update: {
            slug,
            displayName: dto.displayName.trim(),
            enabled: dto.enabled,
          },
        }),
      );
      return {
        slug: portal.slug,
        displayName: portal.displayName,
        enabled: portal.enabled,
      };
    } catch (e) {
      if (
        typeof e === 'object' &&
        e &&
        (e as { code?: string }).code === 'P2002'
      )
        throw new ConflictException('That link name is taken - choose another');
      throw e;
    }
  }
}
