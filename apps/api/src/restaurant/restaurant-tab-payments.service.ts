import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RestaurantTabLineStatus,
  RestaurantTabStatus,
  RestaurantTableStatus,
} from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { SalesService } from '../sales/sales.service';
import { CloseSplitDto, CloseTabDto, PayerDto } from './dto/tab.dto';
import { RestaurantTabsService, toTabView } from './restaurant-tabs.service';

/** A payer's claim on the items it pays for lasts this long if its sale never gets made (a crash); then others may charge them. */
const CLAIM_TTL_MS = 2 * 60_000;

interface Till {
  terminalId: string;
  cashierSessionId: string;
  shiftId?: string;
}

/**
 * Paying a tab. Each payment is an ordinary sale made by SalesService.create() - so stock, discount approval, loyalty, M-Pesa
 * checks, the clientId replay protection and the audit entry all work exactly as at the retail till - for the items that payer
 * covers. A bill can be paid whole, in parts, or split by person; it closes when nothing is left unpaid.
 *
 * Not one transaction (SalesService opens its own), so it is made safe in three steps: the items are CLAIMED for this payment's
 * clientId first (two tills cannot charge the same items), the sale is made, then the tab is updated to say which sale paid
 * which items. A repeat of the same request (same clientId) finds the sale already made and just finishes step three.
 */
@Injectable()
export class RestaurantTabPaymentsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tabs: RestaurantTabsService,
    private readonly sales: SalesService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Pays everything unpaid (or the chosen items) with one payer's payments. */
  close(tabId: string, dto: CloseTabDto) {
    return this.payOne(tabId, dto, dto);
  }

  /** Pays several people's shares, each their own sale. Earlier payments stay made if a later one fails, and the message says so. */
  async closeSplit(tabId: string, dto: CloseSplitDto) {
    const seen = new Set<string>();
    for (const payer of dto.payers) {
      if (!payer.lineIds || payer.lineIds.length === 0)
        throw new BadRequestException(
          'Each person needs to be given their items',
        );
      for (const id of payer.lineIds) {
        if (seen.has(id))
          throw new BadRequestException('An item is given to two people');
        seen.add(id);
      }
    }
    if (new Set(dto.payers.map((p) => p.clientId)).size !== dto.payers.length)
      throw new BadRequestException('Each payment needs its own id');

    const results = [];
    for (const [i, payer] of dto.payers.entries()) {
      try {
        results.push(await this.payOne(tabId, payer, dto));
      } catch (e) {
        if (i === 0 || !(e instanceof HttpException)) throw e;
        const label = payer.label ? `${payer.label}'s` : `Payment ${i + 1}`;
        throw new BadRequestException(
          `${label} payment did not go through: ${e.message}. The ${i} earlier ${i === 1 ? 'payment was' : 'payments were'} made and saved - the bill still shows what is unpaid.`,
        );
      }
    }
    return {
      payments: results.map((r) => ({
        saleId: r.sale.id,
        label: r.label,
        total: Number(r.sale.total),
      })),
      tab: results[results.length - 1].tab,
      closed: results[results.length - 1].closed,
    };
  }

  private async payOne(tabId: string, payer: PayerDto, till: Till) {
    const staleBefore = () => new Date(Date.now() - CLAIM_TTL_MS);

    // 1. Choose and claim the items this payment covers.
    const plan = await this.tenantPrisma.run(async (tx) => {
      const tab = await this.tabs.loadTab(tx, tabId);
      if (tab.status === RestaurantTabStatus.VOID)
        throw new ConflictException('This bill was thrown away');

      // A repeat of a payment that already went through (the same clientId) is answered, not charged again.
      const done = await tx.sale.findUnique({
        where: { clientId: payer.clientId },
        select: { id: true },
      });
      if (done) {
        const linked = await tx.restaurantTabSale.findUnique({
          where: { saleId: done.id },
        });
        if (linked && linked.tabId !== tabId)
          throw new ConflictException(
            'That payment id was already used for a different bill',
          );
        if (linked) return { replay: true as const, saleId: done.id, tab };
      }
      if (tab.status === RestaurantTabStatus.CLOSED)
        throw new ConflictException('This bill has already been paid');

      const unpaid = tab.lines.filter(
        (l) => l.status === RestaurantTabLineStatus.ORDERED,
      );
      const chosen = payer.lineIds
        ? tab.lines.filter((l) => payer.lineIds!.includes(l.id))
        : unpaid;
      if (payer.lineIds && chosen.length !== new Set(payer.lineIds).size)
        throw new NotFoundException('One of those items is not on this bill');
      if (chosen.some((l) => l.status === RestaurantTabLineStatus.PAID))
        throw new ConflictException(
          'One of those items has already been paid for',
        );
      if (chosen.some((l) => l.status === RestaurantTabLineStatus.VOIDED))
        throw new BadRequestException('One of those items was voided');
      if (chosen.length === 0)
        throw new BadRequestException('There is nothing unpaid on this bill');

      const claim = await tx.restaurantTabLine.updateMany({
        where: {
          id: { in: chosen.map((l) => l.id) },
          tabId,
          status: RestaurantTabLineStatus.ORDERED,
          OR: [
            { claimClientId: null },
            { claimClientId: payer.clientId },
            { claimedAt: { lt: staleBefore() } },
          ],
        },
        data: { claimClientId: payer.clientId, claimedAt: new Date() },
      });
      if (claim.count !== chosen.length)
        throw new ConflictException(
          'Someone else is paying for some of these items right now. Wait a moment and look at the bill again.',
        );
      return { replay: false as const, tab, chosen, done: done?.id };
    });

    let saleId: string;
    let sale;
    if (plan.replay) {
      saleId = plan.saleId;
      sale = await this.tenantPrisma.run((tx) =>
        tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: { payments: true },
        }),
      );
    } else {
      // 2. Make the sale. If it is refused (payments do not add up, not enough stock...), let go of the items again.
      try {
        sale = await this.sales.create({
          clientId: payer.clientId,
          branchId: plan.tab.branchId,
          terminalId: till.terminalId,
          cashierSessionId: till.cashierSessionId,
          shiftId: till.shiftId,
          lineItems: plan.chosen.map((l) => ({
            variantId: l.variantId,
            quantity: Number(l.quantity),
          })),
          payments: payer.payments,
          discount: payer.discount,
          customerId: payer.customerId,
          redeemPoints: payer.redeemPoints,
        });
      } catch (e) {
        await this.tenantPrisma.run((tx) =>
          tx.restaurantTabLine.updateMany({
            where: {
              tabId,
              claimClientId: payer.clientId,
              status: RestaurantTabLineStatus.ORDERED,
            },
            data: { claimClientId: null, claimedAt: null },
          }),
        );
        throw e;
      }
      saleId = sale.id;
    }

    // 3. Record which sale paid which items; close the bill when nothing is left.
    return this.tenantPrisma.run(async (tx) => {
      const lineIds = plan.replay ? [] : plan.chosen.map((l) => l.id);
      if (!(await tx.restaurantTabSale.findUnique({ where: { saleId } }))) {
        await tx.restaurantTabSale.create({
          data: { tabId, saleId, label: payer.label || null },
        });
      }
      if (!(await tx.restaurantSaleTable.findUnique({ where: { saleId } }))) {
        const tab = await tx.restaurantTab.findUniqueOrThrow({
          where: { id: tabId },
        });
        await tx.restaurantSaleTable.create({
          data: { saleId, tableId: tab.tableId },
        });
      }
      const tip = payer.tipAmount ?? 0;
      const service = payer.serviceChargeAmount ?? 0;
      if (
        (tip > 0 || service > 0) &&
        !(await tx.restaurantSaleTip.findUnique({ where: { saleId } }))
      ) {
        await tx.restaurantSaleTip.create({
          data: { saleId, tipAmount: tip, serviceChargeAmount: service },
        });
      }
      if (lineIds.length > 0) {
        await tx.restaurantTabLine.updateMany({
          where: {
            id: { in: lineIds },
            status: RestaurantTabLineStatus.ORDERED,
          },
          data: {
            status: RestaurantTabLineStatus.PAID,
            saleId,
            claimClientId: null,
            claimedAt: null,
          },
        });
      }

      const remaining = await tx.restaurantTabLine.count({
        where: { tabId, status: RestaurantTabLineStatus.ORDERED },
      });
      let closed = false;
      const current = await tx.restaurantTab.findUniqueOrThrow({
        where: { id: tabId },
      });
      if (remaining === 0 && current.status === RestaurantTabStatus.OPEN) {
        const sales = await tx.restaurantTabSale.count({ where: { tabId } });
        await tx.restaurantTab.update({
          where: { id: tabId },
          data: {
            status: RestaurantTabStatus.CLOSED,
            closedAt: new Date(),
            saleId: sales === 1 ? saleId : null,
          },
        });
        await tx.restaurantTable.update({
          where: { id: current.tableId },
          data: { status: RestaurantTableStatus.NEEDS_CLEANING },
        });
        await this.auditLog.logInTx(tx, {
          action: 'restaurant.tab_closed',
          entityType: 'RestaurantTab',
          entityId: tabId,
          after: { sales, tableId: current.tableId },
        });
        closed = true;
      }
      if (!plan.replay) {
        await this.auditLog.logInTx(tx, {
          action: 'restaurant.tab_paid',
          entityType: 'RestaurantTab',
          entityId: tabId,
          after: {
            saleId,
            total: Number(sale.total),
            items: lineIds.length,
            tip,
            serviceCharge: service,
            methods: sale.payments.map((p: { method: string }) => p.method),
          },
        });
      }
      const tab = toTabView(await this.tabs.loadTab(tx, tabId));
      return {
        sale,
        tab,
        closed: closed || tab.status === 'CLOSED',
        label: payer.label ?? null,
        tip:
          tip > 0 || service > 0
            ? { tipAmount: tip, serviceChargeAmount: service }
            : null,
      };
    });
  }
}
