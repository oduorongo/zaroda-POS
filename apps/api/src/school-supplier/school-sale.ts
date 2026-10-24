import { SaleStatus } from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';

/** The built-in "device" a school supplier's credit sales are filed under, one per branch. It is not a real till. */
export const SCHOOL_TERMINAL_LABEL = 'School credit sales';

/** The same invoice always maps to the same clientId, so recording it twice can never make two sales. */
export const schoolInvoiceSaleClientId = (invoiceId: string) =>
  `school-invoice-${invoiceId}`;

export interface SchoolSaleLine {
  variantId: string;
  quantity: number;
  unitPrice: number;
  taxAmount: number;
}

/**
 * Writes a school invoice as an ordinary sale (completed, on account) so it appears in Sales, the reports, the profit figures
 * and - when the business sends sales to KRA - goes to eTIMS like any other sale. Stock is NOT touched here: delivering
 * already took it out through the inventory ledger. The money is not taken now: the payment is "on account", and the school's
 * cheque or transfer arrives later as a receipt on the school's statement. Safe to call again for the same invoice.
 * Returns the sale id.
 */
export async function recordSchoolSale(
  tx: TenantTx,
  input: {
    organizationId: string;
    orgUserId: string;
    branchId: string;
    invoiceId: string;
    total: number;
    lines: SchoolSaleLine[];
  },
): Promise<string> {
  const clientId = schoolInvoiceSaleClientId(input.invoiceId);
  const existing = await tx.sale.findUnique({
    where: { clientId },
    select: { id: true },
  });
  if (existing) return existing.id;

  let terminal = await tx.terminal.findFirst({
    where: { branchId: input.branchId, deviceLabel: SCHOOL_TERMINAL_LABEL },
  });
  if (!terminal)
    terminal = await tx.terminal.create({
      data: { branchId: input.branchId, deviceLabel: SCHOOL_TERMINAL_LABEL },
    });
  let session = await tx.cashierSession.findFirst({
    where: {
      terminalId: terminal.id,
      orgUserId: input.orgUserId,
      pinEndedAt: null,
    },
  });
  if (!session)
    session = await tx.cashierSession.create({
      data: { terminalId: terminal.id, orgUserId: input.orgUserId },
    });

  const sale = await tx.sale.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      terminalId: terminal.id,
      cashierSessionId: session.id,
      cashierOrgUserId: input.orgUserId,
      clientId,
      status: SaleStatus.COMPLETED,
      total: input.total,
      lineItems: {
        create: input.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxAmount: l.taxAmount,
        })),
      },
      payments: { create: { method: 'ACCOUNT', amount: input.total } },
    },
    select: { id: true },
  });
  return sale.id;
}
