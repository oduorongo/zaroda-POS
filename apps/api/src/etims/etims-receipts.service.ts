import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { buildReceipt, ReceiptLineIn } from './etims-receipt.util';
import { TaxLetter } from './etims-sales.util';

/** What the sale document kept of what was sent to KRA (see EtimsDocumentsService). */
interface Stored {
  customerPin?: string | null;
  lines: ReceiptLineIn[];
  rates: Partial<Record<TaxLetter, number>>;
  business: { name: string; address: string | null };
  at: string;
}

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'CASH',
  MPESA: 'M-PESA',
  MPESA_RECEIPT: 'M-PESA',
  CARD: 'CARD',
  WALLET: 'WALLET',
  ROOM_CHARGE: 'ROOM CHARGE',
  ACCOUNT: 'ON ACCOUNT',
};

/** The way most of the money came in, as a receipt names it. */
function paymentLabel(payments: { method: string; amount: Prisma.Decimal }[]): string {
  const by = new Map<string, number>();
  for (const p of payments) by.set(p.method, (by.get(p.method) ?? 0) + Number(p.amount));
  const main = [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return main ? (PAYMENT_LABEL[main] ?? main) : 'CASH';
}

/**
 * The receipt a customer is given for a sale or refund KRA has signed: the KRA layout of the TIS specification, with the SCU
 * information KRA returned. It exists only once KRA has answered (the specification forbids a receipt before then). Printing it
 * again later gives a COPY, which is counted for the daily reports.
 */
@Injectable()
export class EtimsReceiptsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async forSale(saleId: string, copy: boolean) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { payments: { select: { method: true, amount: true } } },
      });
      if (!sale) throw new NotFoundException('Sale not found');
      const [docs, device, setting, org, branch] = await Promise.all([
        tx.etimsDocument.findMany({ where: { saleId }, orderBy: { createdAt: 'asc' } }),
        tx.etimsDevice.findUnique({ where: { branchId: sale.branchId } }),
        tx.etimsSetting.findFirst(),
        tx.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, address: true, phone: true, kraPin: true },
        }),
        tx.branch.findUnique({ where: { id: sale.branchId }, select: { name: true, county: true } }),
      ]);
      const label = paymentLabel(sale.payments);
      const sale_doc = docs.find((d) => d.kind === 'SALE');
      const docKind = (k: 'SALE' | 'CREDIT') => (k === 'SALE' ? 'SALE' : 'CREDIT_NOTE');

      const make = (kind: 'SALE' | 'CREDIT') => {
        const d = docs.find((x) => x.kind === docKind(kind));
        if (!d)
          return { receipt: null, state: 'NONE' as const, message: kind === 'SALE' ? 'This sale was not sent to KRA.' : null };
        const stored = d.payload as unknown as Stored | null;
        if (!d.saleDone || !d.rcptSign || !d.intrlData || !d.curRcptNo || !stored || !device?.sdcId)
          return {
            receipt: null,
            state: d.status,
            message:
              d.status === 'REJECTED' || d.status === 'MANUAL'
                ? (d.lastError ?? 'KRA did not accept this one, so it has no KRA receipt.')
                : 'KRA has not signed this one yet. Its receipt can be printed as soon as it has.',
          };
        const original =
          kind === 'CREDIT' && sale_doc?.curRcptNo && device.sdcId
            ? `${device.sdcId}/${sale_doc.curRcptNo}`
            : null;
        return {
          receipt: buildReceipt({
            kind,
            copy,
            business: {
              name: stored.business?.name ?? org?.name ?? '',
              address:
                [org?.address, branch?.name, branch?.county].filter(Boolean).join(', ') ||
                stored.business?.address ||
                null,
              pin: setting?.tin ?? org?.kraPin ?? null,
            },
            buyerPin: stored.customerPin ?? null,
            lines: stored.lines,
            rates: stored.rates,
            payment: { label },
            scu: {
              scuId: device.sdcId,
              receiptNo: d.curRcptNo,
              totalReceiptNo: d.totRcptNo,
              internalData: d.intrlData,
              signature: d.rcptSign,
              at: d.sdcDateTime ?? '',
            },
            tis: { receiptNumber: String(d.invcNo ?? ''), at: new Date(stored.at) },
            originalCuInvoiceNo: original,
          }),
          state: 'SIGNED' as const,
          message: null,
        };
      };

      const result = { sale: make('SALE'), credit: make('CREDIT') };
      if (copy) {
        const me = await tx.orgUser.findUnique({
          where: { id: orgUserId },
          select: { user: { select: { fullName: true } } },
        });
        for (const k of ['SALE', 'CREDIT'] as const) {
          const r = k === 'SALE' ? result.sale : result.credit;
          if (r.receipt)
            await tx.etimsReceiptPrint.create({
              data: {
                organizationId,
                branchId: sale.branchId,
                saleId,
                kind: k,
                createdByName: me?.user.fullName ?? null,
              },
            });
        }
      }
      return result;
    });
  }
}
