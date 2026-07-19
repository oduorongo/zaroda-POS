import { Injectable } from '@nestjs/common';
import {
  PaymentInitiationResult,
  PaymentProcessor,
} from './payment-processor.interface';

/** Cash has no external processor - it settles the instant a cashier records it. */
@Injectable()
export class CashPaymentProcessor implements PaymentProcessor {
  async initiate(): Promise<PaymentInitiationResult> {
    return { settledImmediately: true };
  }
}
