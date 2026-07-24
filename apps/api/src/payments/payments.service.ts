import { Injectable, NotFoundException } from '@nestjs/common';
import { StkRequestStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { MpesaPaymentProcessor } from './mpesa-payment.processor';
import { InitiateMpesaDto } from './dto/initiate-mpesa.dto';

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
   */
  async handleMpesaCallback(organizationId: string, body: DarajaCallbackBody) {
    const callback = body?.Body?.stkCallback;
    if (!callback) return { received: true };

    const items = callback.CallbackMetadata?.Item ?? [];
    const find = (name: string) => items.find((i) => i.Name === name)?.Value;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      await tx.mpesaStkRequest.updateMany({
        where: { checkoutRequestId: callback.CheckoutRequestID },
        data:
          callback.ResultCode === 0
            ? {
                status: StkRequestStatus.SUCCESS,
                mpesaReceiptNumber: String(find('MpesaReceiptNumber') ?? ''),
                resultDesc: callback.ResultDesc,
              }
            : {
                status: StkRequestStatus.FAILED,
                resultDesc: callback.ResultDesc,
              },
      });
    });

    return { received: true };
  }

  /** Polled by the terminal while the customer approves the prompt on their phone. */
  async getMpesaStatus(checkoutRequestId: string) {
    const request = await this.tenantPrisma.run((tx) =>
      tx.mpesaStkRequest.findUnique({ where: { checkoutRequestId } }),
    );
    if (!request) throw new NotFoundException('STK request not found');
    return {
      status: request.status,
      checkoutRequestId: request.checkoutRequestId,
      mpesaReceiptNumber: request.mpesaReceiptNumber,
      resultDesc: request.resultDesc,
    };
  }
}
