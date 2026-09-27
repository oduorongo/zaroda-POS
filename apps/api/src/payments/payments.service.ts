import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StkRequestStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { MpesaPaymentProcessor, StkQueryResult } from './mpesa-payment.processor';
import { InitiateMpesaDto } from './dto/initiate-mpesa.dto';

// See getMpesaStatus - how stale a PENDING row must be before a status poll
// asks Daraja directly instead of waiting on the callback.
const STATUS_REQUERY_MS = 10_000;

interface DarajaCallbackItem {
  Name: string;
  Value?: string | number;
}

interface DarajaCallbackBody {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: { Item: DarajaCallbackItem[] };
    };
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly mpesa: MpesaPaymentProcessor,
  ) {}

  /** Cashier-initiated - runs inside the authenticated request's tenant context. */
  async initiateMpesa(dto: InitiateMpesaDto) {
    const { organizationId } = getTenantStore();
    const result = await this.mpesa.initiate({
      amountKes: dto.amountKes,
      reference: dto.reference,
      phoneNumber: dto.phoneNumber,
      organizationId,
    });

    // initiate() always returns settledImmediately: false for M-Pesa (see
    // payment-processor.interface.ts) - the checkoutRequestId it hands back
    // is what the callback below and the frontend's poll both key on.
    await this.tenantPrisma.run((tx) =>
      tx.mpesaStkRequest.create({
        data: {
          organizationId,
          checkoutRequestId: result.providerReference!,
          reference: dto.reference,
          amount: dto.amountKes,
          phoneNumber: dto.phoneNumber,
          status: StkRequestStatus.PENDING,
        },
      }),
    );

    return { checkoutRequestId: result.providerReference };
  }

  /**
   * Safaricom's webhook - no JWT, so tenant context has to come from the
   * URL (organizationId param) rather than getTenantStore(). Mirrors
   * PublicBookingService's own raw-transaction pattern for the same reason.
   *
   * The body is unauthenticated, so it's treated only as a prompt to
   * reconcile() - the outcome itself always comes from asking Daraja. The
   * one thing taken from the body is the M-Pesa receipt number (the STK
   * query response doesn't include it), and only once Daraja itself has
   * confirmed SUCCESS - so a forged callback can at worst mislabel the
   * receipt number on a payment that genuinely went through.
   */
  async handleMpesaCallback(organizationId: string, body: DarajaCallbackBody) {
    const callback = body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) return { received: true };

    const items = callback.CallbackMetadata?.Item ?? [];
    const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;

    await this.reconcile(
      organizationId,
      callback.CheckoutRequestID,
      receipt !== undefined ? String(receipt) : null,
    );
    return { received: true };
  }

  /**
   * Settles a PENDING request from Daraja's own STK query. Idempotent and
   * safe to race (callback vs. status poll): the write only applies while
   * the row is still PENDING, so whichever lands first wins and the other
   * is a no-op. A Daraja failure leaves the row PENDING to be retried by the
   * next poll, rather than guessing.
   */
  private async reconcile(
    organizationId: string,
    checkoutRequestId: string,
    receiptHint: string | null,
  ) {
    const inTenant = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
        return fn(tx);
      });

    const request = await inTenant((tx) =>
      tx.mpesaStkRequest.findUnique({ where: { checkoutRequestId } }),
    );
    if (!request || request.status !== StkRequestStatus.PENDING) return;

    let result: StkQueryResult;
    try {
      result = await this.mpesa.queryStkStatus(checkoutRequestId);
    } catch {
      result = { state: 'PENDING' };
    }

    await inTenant((tx) =>
      tx.mpesaStkRequest.updateMany({
        where: { checkoutRequestId, status: StkRequestStatus.PENDING },
        data:
          result.state === 'SUCCESS'
            ? {
                status: StkRequestStatus.SUCCESS,
                mpesaReceiptNumber: receiptHint,
                resultDesc: result.resultDesc,
              }
            : result.state === 'FAILED'
              ? { status: StkRequestStatus.FAILED, resultDesc: result.resultDesc }
              : // Still pending - just bump updatedAt, which is what
                // getMpesaStatus throttles its own Daraja queries on.
                { updatedAt: new Date() },
      }),
    );
  }

  /**
   * Polled by the terminal while the customer approves the prompt on their
   * phone. Normally the callback settles the row, but if it was lost or its
   * Daraja check failed, the poll asks Daraja itself - throttled to once per
   * STATUS_REQUERY_MS per request so a 3s poll doesn't hammer the query API.
   */
  async getMpesaStatus(checkoutRequestId: string) {
    const find = () =>
      this.tenantPrisma.run((tx) =>
        tx.mpesaStkRequest.findUnique({ where: { checkoutRequestId } }),
      );
    let request = await find();
    if (!request) throw new NotFoundException('STK request not found');
    if (
      request.status === StkRequestStatus.PENDING &&
      Date.now() - request.updatedAt.getTime() > STATUS_REQUERY_MS
    ) {
      await this.reconcile(getTenantStore().organizationId, checkoutRequestId, null);
      request = (await find())!;
    }
    return {
      status: request.status,
      checkoutRequestId: request.checkoutRequestId,
      mpesaReceiptNumber: request.mpesaReceiptNumber,
      resultDesc: request.resultDesc,
    };
  }
}
