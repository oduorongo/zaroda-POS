import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FarmInputKind, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { GoodsReceiptsService } from '../purchasing/goods-receipts.service';
import { CreateFarmInputDto, ReceiveFarmInputDto } from './dto/inputs.dto';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

/**
 * Farm inputs: what comes into the farm (seed, fertiliser, sprays, vet drugs, bought feed and feed ingredients). Each is a POS
 * product underneath, so stock, cost and deliveries work as everywhere else; farm_inputs keeps them apart from the farm's own
 * products (milk, eggs, harvests, home-mixed feed). A delivery is a goods-received note, booked as owed to the supplier.
 */
@Injectable()
export class FarmInputsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly receipts: GoodsReceiptsService,
  ) {}

  list() {
    return this.tenantPrisma.run(async (tx) => {
      const inputs = await tx.farmInput.findMany();
      if (!inputs.length) return [];
      const products = await tx.product.findMany({ where: { id: { in: inputs.map((i) => i.productId) } }, include: { variants: true } });
      const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
      const stock = await tx.inventoryItem.groupBy({ by: ['variantId'], where: { variantId: { in: variantIds } }, _sum: { quantity: true } });
      const onHand = new Map(stock.map((s) => [s.variantId, n(s._sum.quantity)]));
      return inputs
        .map((i) => {
          const p = products.find((x) => x.id === i.productId);
          if (!p) return null;
          const v = p.variants[0];
          return {
            productId: p.id,
            variantId: v?.id ?? null,
            name: p.name,
            kind: i.kind,
            unit: p.baseUnit,
            mode: v?.quantityMode ?? 'COUNT',
            cost: v?.cost == null ? null : n(v.cost),
            onHand: Math.round(p.variants.reduce((s, x) => s + (onHand.get(x.id) ?? 0), 0) * 1000) / 1000,
            active: p.isActive,
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    });
  }

  /** The product ids that are inputs: the screens use it to keep inputs and the farm's own products apart. */
  async ids(): Promise<string[]> {
    return this.tenantPrisma.run(async (tx) => (await tx.farmInput.findMany({ select: { productId: true } })).map((i) => i.productId));
  }

  create(dto: CreateFarmInputDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      if (await tx.product.findFirst({ where: { name: { equals: dto.name, mode: 'insensitive' }, isActive: true } })) {
        throw new BadRequestException(`There is already an item called ${dto.name}. Move it to Farm inputs instead.`);
      }
      const product = await tx.product.create({
        data: {
          organizationId,
          name: dto.name,
          baseUnit: dto.unit,
          variants: { create: { sku: `IN-${randomBytes(3).toString('hex').toUpperCase()}`, price: 0, cost: dto.cost, quantityMode: dto.mode } },
        },
        include: { variants: true },
      });
      const input = await tx.farmInput.create({ data: { organizationId, productId: product.id, kind: dto.kind } });
      await this.audit.logInTx(tx, { action: 'farm.input_created', entityType: 'FarmInput', entityId: input.id, after: { ...input, name: product.name, cost: dto.cost } });
      return { productId: product.id, variantId: product.variants[0].id, kind: input.kind };
    });
  }

  /** Moves an existing product to Farm inputs (with its kind), or back to the farm's products (kind null). */
  mark(productId: string, kind: FarmInputKind | null) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.product.findUnique({ where: { id: productId } }))) throw new NotFoundException('Product not found');
      const before = await tx.farmInput.findUnique({ where: { organizationId_productId: { organizationId, productId } } });
      const after = kind
        ? await tx.farmInput.upsert({ where: { organizationId_productId: { organizationId, productId } }, create: { organizationId, productId, kind }, update: { kind } })
        : before
          ? await tx.farmInput.delete({ where: { id: before.id } }).then(() => null)
          : null;
      await this.audit.logInTx(tx, { action: 'farm.input_marked', entityType: 'FarmInput', entityId: before?.id ?? after?.id ?? productId, before, after });
      return { productId, kind: after?.kind ?? null };
    });
  }

  /** A delivery of an input: a goods-received note (stock in at the price paid, owed to the supplier until their bill). */
  receive(productId: string, dto: ReceiveFarmInputDto) {
    return this.tenantPrisma.run(async (tx) => {
      const input = await tx.farmInput.findFirst({ where: { productId } });
      if (!input) throw new NotFoundException('That item is not a farm input');
      const variant = await tx.productVariant.findFirst({ where: { productId }, orderBy: { createdAt: 'asc' } });
      if (!variant) throw new NotFoundException('That input has no stock option');
      const branchId = await this.stockBranch(tx);
      return this.receipts.receiveInTx(tx, {
        branchId,
        supplierId: dto.supplierId,
        deliveryNote: dto.deliveryNote,
        notes: 'Farm input received',
        lines: [{ variantId: variant.id, quantity: dto.quantity, unitCost: dto.unitCost ?? (variant.cost == null ? undefined : n(variant.cost)) }],
      } as Parameters<GoodsReceiptsService['receiveInTx']>[1]);
    });
  }

  /** Where the farm keeps its stock: the branch set for produce, else its first branch. */
  private async stockBranch(tx: TenantTx) {
    const s = await tx.farmProduceSettings.findFirst({ select: { branchId: true } });
    const branchId = s?.branchId ?? (await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
    if (!branchId) throw new BadRequestException('Add a branch (farm site) first');
    return branchId;
  }
}
