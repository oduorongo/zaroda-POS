import { SaleStatus } from '@prisma/client';
import { TenantTx } from '../../common/prisma/tenant-scoped-prisma.service';

/** The built-in "device" certificates are filed under, one per branch (not a real till) - same idea as school credit sales. */
export const IPC_TERMINAL_LABEL = 'Construction certificates';
export const IPC_SKU = 'CON-IPC-WORKS';
export const ipcSaleClientId = (valuationId: string) => `con-ipc-${valuationId}`;

/** The branch that sends to KRA: one with an active eTIMS device if there is one, otherwise the business's first non-site branch. */
async function invoiceBranch(tx: TenantTx): Promise<string> {
  const device = await tx.etimsDevice.findFirst({ where: { status: 'ACTIVE' }, select: { branchId: true } });
  if (device) return device.branchId;
  const branch = await tx.branch.findFirst({ where: { conProject: null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!branch) throw new Error('No branch to invoice from');
  return branch.id;
}

/** The catalogue item certificates are invoiced as ("Construction works"), VAT-rated at the given rate. */
async function worksVariant(tx: TenantTx, organizationId: string, vatRate: number): Promise<string> {
  const existing = await tx.productVariant.findFirst({ where: { sku: IPC_SKU }, select: { id: true } });
  if (existing) return existing.id;
  const rate = vatRate / 100;
  const taxClass = (await tx.taxClass.findFirst({ where: { rate, isExempt: false } })) ?? (await tx.taxClass.create({ data: { organizationId, name: `VAT ${vatRate}%`, rate } }));
  const product = await tx.product.create({ data: { organizationId, name: 'Construction works (certified)', baseUnit: 'item', taxClassId: taxClass.id } });
  const variant = await tx.productVariant.create({ data: { productId: product.id, sku: IPC_SKU, price: 0 } });
  return variant.id;
}

/** The client as a customer, so their name and KRA PIN go on the eTIMS invoice. */
async function clientCustomer(tx: TenantTx, organizationId: string, client: { name: string; kraPin: string | null; phone: string | null }): Promise<string> {
  const found = await tx.customer.findFirst({ where: client.kraPin ? { kraPin: client.kraPin } : { name: client.name } });
  if (found) return found.id;
  const phoneTaken = client.phone ? await tx.customer.findFirst({ where: { phone: client.phone } }) : null;
  const created = await tx.customer.create({ data: { organizationId, name: client.name, kraPin: client.kraPin, phone: phoneTaken ? null : client.phone } });
  return created.id;
}

/**
 * Writes a certified IPC as an ordinary completed sale on account (one line: the net certified amount, plus VAT), so it shows in
 * Sales and the reports and - when the business sends sales to KRA - goes to eTIMS like any other sale. No stock moves. The client
 * pays later; payments and withholding certificates are recorded against the IPC. Safe to call twice. Returns the sale id.
 */
export async function recordIpcSale(
  tx: TenantTx,
  input: { organizationId: string; orgUserId: string; valuationId: string; netAmount: number; vatRate: number; vatAmount: number; client: { name: string; kraPin: string | null; phone: string | null } | null },
): Promise<string> {
  const clientId = ipcSaleClientId(input.valuationId);
  const existing = await tx.sale.findUnique({ where: { clientId }, select: { id: true } });
  if (existing) return existing.id;
  const branchId = await invoiceBranch(tx);
  const terminal =
    (await tx.terminal.findFirst({ where: { branchId, deviceLabel: IPC_TERMINAL_LABEL } })) ?? (await tx.terminal.create({ data: { branchId, deviceLabel: IPC_TERMINAL_LABEL } }));
  const session =
    (await tx.cashierSession.findFirst({ where: { terminalId: terminal.id, orgUserId: input.orgUserId, pinEndedAt: null } })) ??
    (await tx.cashierSession.create({ data: { terminalId: terminal.id, orgUserId: input.orgUserId } }));
  const variantId = await worksVariant(tx, input.organizationId, input.vatRate);
  const total = Math.round((input.netAmount + input.vatAmount) * 100) / 100;
  const sale = await tx.sale.create({
    data: {
      organizationId: input.organizationId,
      branchId,
      terminalId: terminal.id,
      cashierSessionId: session.id,
      cashierOrgUserId: input.orgUserId,
      clientId,
      status: SaleStatus.COMPLETED,
      total,
      customerId: input.client ? await clientCustomer(tx, input.organizationId, input.client) : null,
      lineItems: { create: [{ variantId, quantity: 1, unitPrice: input.netAmount, taxAmount: input.vatAmount }] },
      payments: { create: { method: 'ACCOUNT', amount: total } },
    },
    select: { id: true },
  });
  return sale.id;
}

/** Credits a reversed IPC's invoice in full: a refund of its sale, which eTIMS sends as a credit note. Safe to call twice. */
export async function creditIpcSale(tx: TenantTx, input: { saleId: string; amount: number; orgUserId: string; reversalId: string; reason: string }) {
  const clientId = `con-ipc-credit-${input.reversalId}`;
  if (await tx.refund.findUnique({ where: { clientId } })) return;
  await tx.refund.create({ data: { saleId: input.saleId, amount: input.amount, reason: input.reason.slice(0, 200), approvedById: input.orgUserId, clientId } });
}
