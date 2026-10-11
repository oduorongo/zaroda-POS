import { DeliveryAudience } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { MAX_CASH_COLLECTED, MAX_FEE, MIN_FEE } from '../delivery.util';

/** The shop asking for a rider: who may quote. */
export class RequestDeliveryDto {
  @IsEnum(DeliveryAudience)
  audience!: DeliveryAudience;

  // Only for ONE_RIDER: the rider the shop picked.
  @ValidateIf((o: RequestDeliveryDto) => o.audience === DeliveryAudience.ONE_RIDER)
  @IsUUID()
  riderId?: string;
}

export class CancelDeliveryDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  reason?: string;
}

export class QuoteDto {
  @IsInt({ message: 'The delivery price must be a whole number of shillings' })
  @Min(MIN_FEE, { message: `The delivery price must be at least KES ${MIN_FEE}` })
  @Max(MAX_FEE, { message: `The delivery price can't be more than KES ${MAX_FEE}` })
  fee!: number;

  @IsInt()
  @Min(1)
  @Max(600)
  @IsOptional()
  etaMinutes?: number;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  note?: string;
}

export class DeliverDto {
  @Matches(/^\s*\d{4}\s*$/, { message: 'Enter the 4-digit code the customer gives you' })
  code!: string;

  // The cash the rider actually collected. Defaults to the agreed price.
  @IsInt()
  @Min(0)
  @Max(MAX_CASH_COLLECTED)
  @IsOptional()
  cashCollected?: number;
}
