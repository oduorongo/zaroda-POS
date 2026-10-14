import { OnlineOrder, OnlineOrderLine, SaleStatus } from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';

type OrderWithLines = OnlineOrder & { lines: OnlineOrderLine[] };

/** The built-in "device" online sales are filed under, one per branch. It is not a real till. */
export const ONLINE_TERMINAL_LABEL = 'Online shop';

/** Same order always maps to the same clientId, so recording it twice can never make two sales. */
export const onlineSaleClientId = (orderId: string) => `online-order-${orderId}`;

/**
 * Writes an accepted online order as an ordinary till sale (M-Pesa, completed) so it appears in
 * Sales, Reports and profit like any other. Stock is NOT touched here - accepting already deducted
 * it through the inventory ledger. Prices are what the shopper paid, so no tax is added on top.
 * Returns the sale id; safe to call again for the same order.
 */
export async function recordOnlineSale(tx: TenantTx, order: OrderWithLines): Promise<string> {
  const { organizationId, orgUserId } = getTenantStore();
  const clientId = onlineSaleClientId(order.id);

  const existing = await tx.sale.findUnique({ where: { clientId }, select: { id: true } });
  if (existing) return existing.id;

  let terminal = await tx.terminal.findFirst({ where: { branchId: order.branchId, deviceLabel: ONLINE_TERMINAL_LABEL } });
  if (!terminal) terminal = await tx.terminal.create({ data: { branchId: order.branchId, deviceLabel: ONLINE_TERMINAL_LABEL } });

  // The sale is credited to whoever accepted the order. Their open "online" session is reused.
  let session = await tx.cashierSession.findFirst({ where: { terminalId: terminal.id, orgUserId, pinEndedAt: null } });
  if (!session) session = await tx.cashierSession.create({ data: { terminalId: terminal.id, orgUserId } });

  const total = Number(order.subtotal);
  const sale = await tx.sale.create({
    data: {
      organizationId,
      branchId: order.branchId,
      terminalId: terminal.id,
      cashierSessionId: session.id,
      cashierOrgUserId: orgUserId,
      clientId,
      status: SaleStatus.COMPLETED,
      total,
      lineItems: {
        create: order.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice, taxAmount: 0 })),
      },
      payments: {
        create: {
          method: 'MPESA',
          amount: total,
          providerReference: order.mpesaReceiptNumber,
          settlementCurrency: 'KES',
          settlementAmount: total,
        },
      },
    },
    select: { id: true },
  });
  return sale.id;
}

/** An order cancelled after acceptance takes its sale back out of the books (the stock is returned separately). */
export async function voidOnlineSale(tx: TenantTx, saleId: string | null): Promise<void> {
  if (!saleId) return;
  await tx.sale.updateMany({ where: { id: saleId, status: SaleStatus.COMPLETED }, data: { status: SaleStatus.VOIDED } });
}
