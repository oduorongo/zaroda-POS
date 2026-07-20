import {
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRefundDto {
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
