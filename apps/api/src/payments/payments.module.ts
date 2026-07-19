import { Global, Module } from '@nestjs/common';
import { CashPaymentProcessor } from './cash-payment.processor';
import { MpesaPaymentProcessor } from './mpesa-payment.processor';

@Global()
@Module({
  providers: [CashPaymentProcessor, MpesaPaymentProcessor],
  exports: [CashPaymentProcessor, MpesaPaymentProcessor],
})
export class PaymentsModule {}
