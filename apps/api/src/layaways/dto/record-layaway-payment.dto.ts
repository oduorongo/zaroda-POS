import { IsIn, IsNumber, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class RecordLayawayPaymentDto {
  // Cash-only, same rationale as SalesService.create() - M-Pesa is async
  // and needs a callback flow not built yet.
  @IsIn(['CASH'] satisfies PaymentMethod[])
  method!: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}
