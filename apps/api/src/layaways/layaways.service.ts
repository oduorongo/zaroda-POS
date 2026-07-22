import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, LayawayStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AuditLogService } from '../common/audit/audit-log.service';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { assertQuantityMatchesMode } from '../common/inventory/quantity-mode.util';
import { CustomersService } from '../customers/customers.service';
import { CreateLayawayDto } from './dto/create-layaway.dto';
import { RecordLayawayPaymentDto } from './dto/record-layaway-payment.dto';
import { CancelLayawayDto } from './dto/cancel-layaway.dto';

const LAYAWAY_INCLUDE = {
  lineItems: { include: { variant: { include: { product: true } } } },
  payments: true,
  customer: true,
} as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class LayawaysService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly customers: CustomersService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Deliberately does not touch inventory - see the schema comment above
   * the Layaway model. Prices/tax are snapshotted at creation the same way
   * a sale's line items are, so a later price change doesn't retroactively
   * change what the customer agreed to pay.
   */
  async create(dto: CreateLayawayDto) {
    return this.tenantPrisma.run(async (tx) => {
      const [branch, customer] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        this.customers.findByIdInTx(tx, dto.customerId),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!customer) throw new NotFoundException('Customer not found');

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

      let total = 0;
      const lineItemRows = dto.lineItems.map((li) => {
        const variant = variantById.get(li.variantId)!;
        assertQuantityMatchesMode(
          variant.quantityMode,
          li.quantity,
          `Quantity for ${variant.sku}`,
        );
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
        };
      });
      total = round2(total);

      const { organizationId } = getTenantStore();
      const layaway = await tx.layaway.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          customerId: dto.customerId,
          total,
          lineItems: { create: lineItemRows },
        },
        include: LAYAWAY_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'layaway.created',
        entityType: 'Layaway',
        entityId: layaway.id,
        after: {
          total,
          customerId: dto.customerId,
          lineItemCount: lineItemRows.length,
        },
      });

      return layaway;
    });
  }

  findAll(filters: {
    branchId?: string;
    customerId?: string;
    status?: LayawayStatus;
  }) {
    return this.tenantPrisma.run((tx) =>
      tx.layaway.findMany({
        where: {
          branchId: filters.branchId,
          customerId: filters.customerId,
          status: filters.status,
        },
        include: LAYAWAY_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const layaway = await this.tenantPrisma.run((tx) =>
      tx.layaway.findUnique({ where: { id }, include: LAYAWAY_INCLUDE }),
    );
    if (!layaway) throw new NotFoundException('Layaway not found');
    return layaway;
  }

  /**
   * A deposit or installment - can be recorded any number of times while
   * OPEN. Rejected once depositPaid would exceed total (no change-giving
   * modeled here; the last installment should be sized to exactly close
   * the balance) or once the layaway is no longer OPEN.
   */
  async recordPayment(id: string, dto: RecordLayawayPaymentDto) {
    return this.tenantPrisma.run(async (tx) => {
      const layaway = await tx.layaway.findUnique({ where: { id } });
      if (!layaway) throw new NotFoundException('Layaway not found');
      if (layaway.status !== LayawayStatus.OPEN) {
        throw new BadRequestException(
          `This layaway is ${layaway.status.toLowerCase()} - payments can only be recorded while OPEN`,
        );
      }

      const newDepositPaid = round2(Number(layaway.depositPaid) + dto.amount);
      if (newDepositPaid > Number(layaway.total)) {
        throw new BadRequestException(
          `Payment of ${dto.amount.toFixed(2)} would exceed the remaining balance of ${(Number(layaway.total) - Number(layaway.depositPaid)).toFixed(2)}`,
        );
      }

      const [updated] = await Promise.all([
        tx.layaway.update({
          where: { id },
          data: { depositPaid: newDepositPaid },
          include: LAYAWAY_INCLUDE,
        }),
        tx.layawayPayment.create({
          data: { layawayId: id, amount: dto.amount, method: dto.method },
        }),
      ]);

      await this.auditLog.logInTx(tx, {
        action: 'layaway.payment_recorded',
        entityType: 'Layaway',
        entityId: id,
        after: {
          amount: dto.amount,
          depositPaid: newDepositPaid,
          total: Number(layaway.total),
        },
      });

      return updated;
    });
  }

  /**
   * Pickup: requires the balance fully paid, then decrements inventory
   * through the same shared recordInTx path a sale uses - this is the
   * only point in a layaway's lifecycle where stock actually moves.
   */
  async complete(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const layaway = await tx.layaway.findUnique({
        where: { id },
        include: { lineItems: true },
      });
      if (!layaway) throw new NotFoundException('Layaway not found');
      if (layaway.status !== LayawayStatus.OPEN) {
        throw new BadRequestException(
          `This layaway is already ${layaway.status.toLowerCase()}`,
        );
      }
      if (Number(layaway.depositPaid) < Number(layaway.total)) {
        throw new BadRequestException(
          `Balance not fully paid: ${(Number(layaway.total) - Number(layaway.depositPaid)).toFixed(2)} remaining`,
        );
      }

      for (const line of layaway.lineItems) {
        await this.inventoryTransactions.recordInTx(tx, {
          branchId: layaway.branchId,
          variantId: line.variantId,
          type: InventoryTxnType.SALE,
          quantityDelta: -Number(line.quantity),
          referenceId: layaway.id,
        });
      }

      const updated = await tx.layaway.update({
        where: { id },
        data: { status: LayawayStatus.COMPLETED, completedAt: new Date() },
        include: LAYAWAY_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'layaway.completed',
        entityType: 'Layaway',
        entityId: id,
        after: { total: Number(layaway.total) },
      });

      return updated;
    });
  }

  /**
   * Cancellation is deliberately just a status change - it does not
   * automatically create a cash refund transaction for any deposit
   * already paid. Whether a cancelled layaway's deposit is refunded,
   * partially forfeited, or kept as store credit is a store-policy
   * decision this pilot doesn't make on the tenant's behalf; the audit
   * log records the deposit amount at cancellation time so that decision
   * can be handled manually/at the register.
   */
  async cancel(id: string, dto: CancelLayawayDto) {
    return this.tenantPrisma.run(async (tx) => {
      const layaway = await tx.layaway.findUnique({ where: { id } });
      if (!layaway) throw new NotFoundException('Layaway not found');
      if (layaway.status !== LayawayStatus.OPEN) {
        throw new BadRequestException(
          `This layaway is already ${layaway.status.toLowerCase()}`,
        );
      }

      const updated = await tx.layaway.update({
        where: { id },
        data: { status: LayawayStatus.CANCELLED, cancelledAt: new Date() },
        include: LAYAWAY_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'layaway.cancelled',
        entityType: 'Layaway',
        entityId: id,
        before: { status: layaway.status },
        after: {
          status: LayawayStatus.CANCELLED,
          reason: dto.reason,
          depositPaidAtCancellation: Number(layaway.depositPaid),
        },
      });

      return updated;
    });
  }
}
