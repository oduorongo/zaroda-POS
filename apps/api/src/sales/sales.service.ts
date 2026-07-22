import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DiscountType,
  InventoryTxnType,
  Prisma,
  Role,
  SaleStatus,
} from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AuditLogService } from '../common/audit/audit-log.service';
import { assertQuantityMatchesMode } from '../common/inventory/quantity-mode.util';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { CustomersService } from '../customers/customers.service';
import { RecipesService } from '../recipes/recipes.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
import { CreateRefundDto } from './dto/create-refund.dto';

const SALE_INCLUDE = {
  lineItems: { include: { ingredients: true } },
  payments: true,
  discounts: true,
  refunds: true,
} as const;
const SUPERVISOR_OR_ABOVE: Role[] = [Role.SUPERVISOR, Role.MANAGER, Role.OWNER];
const round2 = (n: number) => Math.round(n * 100) / 100;

// Loyalty rates are hardcoded org-wide for the pilot rather than a
// per-org config table - a real config screen is a natural Phase 3+
// follow-up once there's a back-office UI to put it in, same deferral
// pattern as the M-Pesa credentials. 1 point earned per 100 (base
// currency) spent, floored; each redeemed point is worth 1 unit of value.
const LOYALTY_EARN_RATE = 100;
const LOYALTY_REDEEM_VALUE = 1;

@Injectable()
export class SalesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly customers: CustomersService,
    private readonly recipes: RecipesService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Cash-only in this increment (DESIGN.md sales-pipeline decision): M-Pesa
   * STK push is async (the customer approves on their phone before it
   * settles), which needs a pending-payment status and a callback webhook
   * to complete correctly - deferred until there are real credentials to
   * design and test that flow against, rather than guess at it. Rejecting
   * non-cash methods here is deliberate, not an oversight - see
   * payments/mpesa-payment.processor.ts.
   */
  async create(dto: CreateSaleDto) {
    const nonCash = dto.payments.find((p) => p.method !== 'CASH');
    if (nonCash) {
      throw new BadRequestException(
        `Payment method ${nonCash.method} is not wired into sale completion yet - only CASH is supported until M-Pesa credentials are available (see payments/mpesa-payment.processor.ts).`,
      );
    }

    try {
      const { sale, isNew } = await this.createInner(dto);
      // Fired after the transaction has committed (not from inside it) so
      // a slow/misbehaving hook (DESIGN.md §3 - e.g. a future restaurant
      // module routing an order to a KDS) can't hold the sale's own DB
      // transaction open while it runs. Never fired for an idempotent
      // replay - a hook that prints a receipt or fires a KDS ticket must
      // not re-fire just because a network retry re-submitted the same
      // clientId.
      if (isNew) {
        await this.events.emitAsync('sale.afterComplete', sale);
      }
      return sale;
    } catch (e) {
      // The findUnique-then-create idempotency check below isn't atomic
      // against a *concurrent* identical submission (two requests can both
      // pass the findUnique before either creates the row) - the unique
      // constraint on Sale.clientId is the real backstop for that race,
      // but until now it surfaced as a raw, unhandled
      // PrismaClientKnownRequestError (P2002) reaching the client as a
      // 500 instead of the same idempotent response a non-racing retry
      // gets. A load test firing the same clientId concurrently caught
      // this. Recovered here by re-reading the row the other request just
      // created, rather than making the client retry blind.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.tenantPrisma.run((tx) =>
          tx.sale.findUnique({
            where: { clientId: dto.clientId },
            include: SALE_INCLUDE,
          }),
        );
        if (existing) return existing;
      }
      throw e;
    }
  }

  private async createInner(dto: CreateSaleDto) {
    return this.tenantPrisma.run(async (tx) => {
      // Idempotent: a retried submission with the same client-generated id
      // returns the original sale rather than erroring or double-selling
      // (DESIGN.md §6 - the same principle applies online, not just to
      // offline sync replay, since network retries can duplicate a submit).
      const existing = await tx.sale.findUnique({
        where: { clientId: dto.clientId },
        include: SALE_INCLUDE,
      });
      if (existing) return { sale: existing, isNew: false };

      const [branch, terminal, cashierSession] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.terminal.findUnique({ where: { id: dto.terminalId } }),
        tx.cashierSession.findUnique({ where: { id: dto.cashierSessionId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!terminal) throw new NotFoundException('Terminal not found');
      if (!cashierSession)
        throw new NotFoundException('Cashier session not found');
      if (cashierSession.pinEndedAt) {
        throw new BadRequestException(
          'This cashier session has already ended - PIN in again to start a new one',
        );
      }

      const variantIds = dto.lineItems.map((li) => li.variantId);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: { product: { include: { taxClass: true } } },
      });
      const variantById = new Map(variants.map((v) => [v.id, v]));
      const missing = variantIds.filter((id) => !variantById.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(
          `Unknown product variant(s): ${missing.join(', ')}`,
        );
      }

      // A variant with recipe rows is "made", not "resold as-is" (see the
      // schema comment on RecipeIngredient) - its own stock never moves on
      // sale, its ingredients' stock does, by (recipe quantity × line
      // quantity). A variant absent from this map has no recipe and keeps
      // the old plain-stock behavior untouched below.
      const recipesByVariant = await this.recipes.loadRecipesInTx(
        tx,
        variantIds,
      );

      let total = 0;
      const lineItemRows = dto.lineItems.map((li) => {
        const variant = variantById.get(li.variantId)!;
        assertQuantityMatchesMode(
          variant.quantityMode,
          li.quantity,
          `Quantity for ${variant.sku}`,
        );
        const recipe = recipesByVariant.get(li.variantId);
        if (recipe) {
          for (const ingredient of recipe) {
            assertQuantityMatchesMode(
              ingredient.ingredientVariant.quantityMode,
              Number(ingredient.quantity) * li.quantity,
              `Quantity for ${ingredient.ingredientVariant.sku} (ingredient of ${variant.sku})`,
            );
          }
        }
        const unitPrice = Number(variant.price);
        const lineSubtotal = unitPrice * li.quantity;
        const taxClass = variant.product.taxClass;
        const taxAmount =
          taxClass && !taxClass.isExempt
            ? lineSubtotal * Number(taxClass.rate)
            : 0;
        total += lineSubtotal + taxAmount;
        return {
          variantId: li.variantId,
          quantity: li.quantity,
          unitPrice,
          taxAmount,
          batchId: li.batchId,
        };
      });

      // Discounts apply to the post-tax ticket total (the amount actually
      // charged), not to the pre-tax subtotal - simplest and matches how a
      // cashier physically keys "10% off the whole ticket" at the register.
      // The approver is re-verified against the database on every sale: the
      // client sends approvedById, but a cashier could otherwise pass their
      // own id and grant themselves a discount, so trusting the client's
      // claim of who authorized it would defeat the whole point of requiring
      // approval.
      let discountAmount = 0;
      if (dto.discount) {
        const approver = await tx.orgUser.findUnique({
          where: { id: dto.discount.approvedById },
        });
        if (!approver || !SUPERVISOR_OR_ABOVE.includes(approver.role)) {
          throw new BadRequestException(
            'Discount approver must be a supervisor, manager, or owner in this organization',
          );
        }

        if (dto.discount.type === DiscountType.PERCENT) {
          if (dto.discount.value > 100) {
            throw new BadRequestException(
              'A percent discount cannot exceed 100',
            );
          }
          discountAmount = round2(total * (dto.discount.value / 100));
        } else {
          discountAmount = round2(dto.discount.value);
        }

        if (discountAmount > total) {
          throw new BadRequestException(
            `Discount amount ${discountAmount.toFixed(2)} cannot exceed the sale total ${total.toFixed(2)}`,
          );
        }
      }

      const discountedTotal = round2(total - discountAmount);

      // A customer is optional (most sales are anonymous walk-ins), but
      // redeeming points requires one - and the customer must actually
      // belong to this tenant and have enough points, both re-verified
      // against the database rather than trusted from the client (same
      // reasoning as the discount approver check above).
      const customer = dto.customerId
        ? await this.customers.findByIdInTx(tx, dto.customerId)
        : null;
      if (dto.customerId && !customer) {
        throw new NotFoundException('Customer not found');
      }
      if (dto.redeemPoints && !dto.customerId) {
        throw new BadRequestException(
          'Redeeming loyalty points requires customerId',
        );
      }

      let redemptionValue = 0;
      if (dto.redeemPoints) {
        if (customer!.loyaltyPoints < dto.redeemPoints) {
          throw new BadRequestException(
            `Customer only has ${customer!.loyaltyPoints} loyalty points, cannot redeem ${dto.redeemPoints}`,
          );
        }
        redemptionValue = round2(dto.redeemPoints * LOYALTY_REDEEM_VALUE);
        if (redemptionValue > discountedTotal) {
          throw new BadRequestException(
            `Redemption value ${redemptionValue.toFixed(2)} cannot exceed the sale total ${discountedTotal.toFixed(2)}`,
          );
        }
      }

      const finalTotal = round2(discountedTotal - redemptionValue);
      const paymentsTotal = dto.payments.reduce((sum, p) => sum + p.amount, 0);
      if (Math.abs(paymentsTotal - finalTotal) > 0.01) {
        throw new BadRequestException(
          `Payments total ${paymentsTotal.toFixed(2)} does not match sale total ${finalTotal.toFixed(2)}`,
        );
      }

      // Earned on the amount actually paid (post-discount, post-redemption)
      // - spending points to earn points back would let a customer cycle
      // an ever-larger balance out of nothing.
      const pointsEarned = customer
        ? Math.floor(finalTotal / LOYALTY_EARN_RATE)
        : 0;

      // Fired inside the transaction, before the sale row exists, so a
      // listener that throws (DESIGN.md §3 - e.g. a future restaurant
      // module rejecting a sale for a table that's already closed out)
      // aborts the whole transaction naturally rather than needing its
      // own rollback logic. Awaited (emitAsync, not emit) specifically so
      // a throw actually propagates - fire-and-forget emit() would let
      // the sale complete regardless of what a hook decided.
      await this.events.emitAsync('sale.beforeComplete', {
        branchId: dto.branchId,
        terminalId: dto.terminalId,
        customerId: dto.customerId,
        lineItems: dto.lineItems,
        total: finalTotal,
      });

      const { organizationId } = getTenantStore();
      const sale = await tx.sale.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          terminalId: dto.terminalId,
          shiftId: dto.shiftId,
          cashierSessionId: dto.cashierSessionId,
          cashierOrgUserId: cashierSession.orgUserId,
          clientId: dto.clientId,
          status: SaleStatus.COMPLETED,
          total: finalTotal,
          customerId: dto.customerId,
          pointsEarned,
          pointsRedeemed: dto.redeemPoints ?? 0,
          lineItems: { create: lineItemRows },
          payments: {
            create: dto.payments.map((p) => ({
              method: p.method,
              amount: p.amount,
            })),
          },
          discounts: dto.discount
            ? {
                create: {
                  type: dto.discount.type,
                  value: dto.discount.value,
                  approvedById: dto.discount.approvedById,
                },
              }
            : undefined,
        },
        include: SALE_INCLUDE,
      });

      // Persisted line ids, grouped by variantId, to pair each lineItemRow
      // back to its real SaleLineItem.id below - `sale.lineItems` doesn't
      // preserve dto.lineItems' order, but every line for the same variant
      // shares the same recipe, so exact index correspondence within a
      // variant's group doesn't matter, only the count does.
      const persistedIdsByVariant = new Map<string, string[]>();
      for (const persisted of sale.lineItems) {
        const ids = persistedIdsByVariant.get(persisted.variantId) ?? [];
        ids.push(persisted.id);
        persistedIdsByVariant.set(persisted.variantId, ids);
      }

      for (const line of lineItemRows) {
        const saleLineItemId = persistedIdsByVariant
          .get(line.variantId)!
          .shift()!;
        const recipe = recipesByVariant.get(line.variantId);

        if (recipe) {
          for (const ingredient of recipe) {
            const consumed = Number(ingredient.quantity) * line.quantity;
            await this.inventoryTransactions.recordInTx(tx, {
              branchId: dto.branchId,
              variantId: ingredient.ingredientVariantId,
              type: InventoryTxnType.SALE,
              quantityDelta: -consumed,
              referenceId: sale.id,
            });
            await tx.saleLineItemIngredient.create({
              data: {
                saleLineItemId,
                ingredientVariantId: ingredient.ingredientVariantId,
                quantity: consumed,
              },
            });
          }
        } else {
          await this.inventoryTransactions.recordInTx(tx, {
            branchId: dto.branchId,
            variantId: line.variantId,
            type: InventoryTxnType.SALE,
            quantityDelta: -line.quantity,
            referenceId: sale.id,
            batchId: line.batchId,
          });
        }
      }

      if (customer) {
        const netPoints = pointsEarned - (dto.redeemPoints ?? 0);
        if (netPoints !== 0) {
          await this.customers.adjustPointsInTx(tx, customer.id, netPoints);
        }
      }

      await this.auditLog.logInTx(tx, {
        action: 'sale.created',
        entityType: 'Sale',
        entityId: sale.id,
        after: {
          total: finalTotal,
          lineItemCount: lineItemRows.length,
          ...(dto.discount
            ? {
                discount: {
                  type: dto.discount.type,
                  value: dto.discount.value,
                  amount: discountAmount,
                  approvedById: dto.discount.approvedById,
                },
              }
            : {}),
          ...(customer
            ? {
                loyalty: {
                  customerId: customer.id,
                  pointsEarned,
                  pointsRedeemed: dto.redeemPoints ?? 0,
                  redemptionValue,
                },
              }
            : {}),
        },
        terminalId: dto.terminalId,
      });

      return { sale, isNew: true };
    });
  }

  findAll(filters: { branchId?: string; shiftId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.sale.findMany({
        where: { branchId: filters.branchId, shiftId: filters.shiftId },
        include: SALE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const sale = await this.tenantPrisma.run((tx) =>
      tx.sale.findUnique({ where: { id }, include: SALE_INCLUDE }),
    );
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  /**
   * Reverses the sale's inventory decrement and marks it VOIDED - never
   * deletes the row (audit trail requirement, DESIGN.md §3). A sale can
   * only be voided once; voiding an already-voided sale is rejected rather
   * than silently double-reversing inventory.
   */
  async void(id: string, dto: VoidSaleDto) {
    return this.tenantPrisma.run(async (tx: TenantTx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { lineItems: { include: { ingredients: true } } },
      });
      if (!sale) throw new NotFoundException('Sale not found');
      if (sale.status === SaleStatus.VOIDED) {
        throw new ConflictException('This sale has already been voided');
      }

      for (const line of sale.lineItems) {
        if (line.ingredients.length > 0) {
          // Recipe-tracked line: reverse exactly what was snapshotted as
          // consumed at sale time (SaleLineItemIngredient), not whatever
          // the recipe says today - see that model's schema comment. The
          // line's own variant (the dish) never had its own stock moved,
          // so nothing to reverse for it directly.
          for (const ingredient of line.ingredients) {
            await this.inventoryTransactions.recordInTx(tx, {
              branchId: sale.branchId,
              variantId: ingredient.ingredientVariantId,
              type: InventoryTxnType.RETURN,
              quantityDelta: Number(ingredient.quantity),
              referenceId: sale.id,
            });
          }
        } else {
          await this.inventoryTransactions.recordInTx(tx, {
            branchId: sale.branchId,
            variantId: line.variantId,
            type: InventoryTxnType.RETURN,
            quantityDelta: Number(line.quantity),
            referenceId: sale.id,
          });
        }
      }

      // Reverse the loyalty effect this sale had: give back any points it
      // redeemed, take back any it earned. If the customer has since spent
      // the earned points elsewhere, this can put their balance below zero
      // - accepted here the same way oversells are accepted elsewhere in
      // this system (DESIGN.md's "never lose a sale, reconcile after the
      // fact" principle), rather than blocking the void.
      if (sale.customerId) {
        const netPoints = sale.pointsEarned - sale.pointsRedeemed;
        if (netPoints !== 0) {
          await this.customers.adjustPointsInTx(
            tx,
            sale.customerId,
            -netPoints,
          );
        }
      }

      const updated = await tx.sale.update({
        where: { id },
        data: { status: SaleStatus.VOIDED },
        include: SALE_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'sale.voided',
        entityType: 'Sale',
        entityId: id,
        before: { status: sale.status },
        after: { status: SaleStatus.VOIDED, reason: dto.reason },
      });

      return updated;
    });
  }

  /**
   * A partial or full MONETARY refund against a completed sale -
   * deliberately not a goods return: the Refund model has no line-item
   * reference (unlike void(), which reverses every line's inventory), so
   * this is scoped to what it actually models - "we gave the customer
   * money back" (a pricing mistake, a complaint, a goodwill gesture),
   * distinct from void's "this whole sale never happened, take the stock
   * back." A refund that also needs to return goods should void the sale
   * instead; this endpoint intentionally does not touch inventory.
   *
   * Multiple partial refunds against the same sale are allowed, capped
   * at the sale's total combined across all of them - the approver is
   * re-verified against the database on every refund, never trusted from
   * the client, same reasoning as a sale's discount approver.
   */
  async refund(saleId: string, dto: CreateRefundDto) {
    const refund = await this.tenantPrisma.run(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { refunds: true },
      });
      if (!sale) throw new NotFoundException('Sale not found');
      if (sale.status === SaleStatus.VOIDED) {
        throw new BadRequestException('Cannot refund a voided sale');
      }

      const approver = await tx.orgUser.findUnique({
        where: { id: dto.approvedById },
      });
      if (!approver || !SUPERVISOR_OR_ABOVE.includes(approver.role)) {
        throw new BadRequestException(
          'Refund approver must be a supervisor, manager, or owner in this organization',
        );
      }

      const alreadyRefunded = round2(
        sale.refunds.reduce((sum, r) => sum + Number(r.amount), 0),
      );
      const remaining = round2(Number(sale.total) - alreadyRefunded);
      const amount = round2(dto.amount);
      if (amount > remaining) {
        throw new BadRequestException(
          `Refund amount ${amount.toFixed(2)} exceeds the remaining refundable balance of ${remaining.toFixed(2)} (${alreadyRefunded.toFixed(2)} already refunded on this sale)`,
        );
      }

      const created = await tx.refund.create({
        data: {
          saleId,
          amount,
          reason: dto.reason,
          approvedById: dto.approvedById,
        },
      });

      await this.auditLog.logInTx(tx, {
        action: 'sale.refunded',
        entityType: 'Sale',
        entityId: saleId,
        after: { amount, reason: dto.reason, approvedById: dto.approvedById },
      });

      return created;
    });

    // The fourth core domain event (industry-module-manifest.interface.ts)
    // - unwireable until now because nothing in core ever created a
    // Refund row to fire it from. Fired after the transaction commits,
    // same reasoning as sale.afterComplete: a slow/misbehaving hook
    // shouldn't hold this transaction open.
    await this.events.emitAsync('refund.afterApproved', refund);

    return this.tenantPrisma.run((tx) =>
      tx.sale.findUnique({ where: { id: saleId }, include: SALE_INCLUDE }),
    );
  }
}
