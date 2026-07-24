import { Global, Module } from '@nestjs/common';
import { CashPaymentProcessor } from './cash-payment.processor';
import { MpesaPaymentProcessor } from './mpesa-payment.processor';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Global()
@Module({
  controllers: [PaymentsController],
  providers: [CashPaymentProcessor, MpesaPaymentProcessor, PaymentsService],
  exports: [CashPaymentProcessor, MpesaPaymentProcessor],
})
export class PaymentsModule {}
