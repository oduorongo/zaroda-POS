import {
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRefundDto {
  /** Client-generated idempotency key (DESIGN.md §6) - resubmitting the same clientId returns the original refund instead of erroring or double-refunding. */
  @IsUUID()
  clientId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  // Re-verified server-side against the database, never trusted from the
  // client - same reasoning as a sale's discount approver
  // (SalesService.create()).
  @IsUUID()
  approvedById!: string;
}
