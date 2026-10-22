import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BillPaymentMethod } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A supplier's invoice entered by hand (one that did not come from a goods-received note). */
export class CreateSupplierBillDto {
  @IsUUID()
  supplierId!: string;

  /** The supplier's invoice number. */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  billNumber!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  total!: number;

  @IsDateString()
  @IsOptional()
  billDate?: string;

  /** Left out, the supplier's payment terms decide it. */
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsUUID()
  @IsOptional()
  purchaseOrderId?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class PayBillDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  amount!: number;

  @IsEnum(BillPaymentMethod)
  method!: BillPaymentMethod;

  /** M-Pesa code, bank reference or cheque number. Needed for everything but cash. */
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(60)
  reference?: string;

  @IsDateString()
  @IsOptional()
  paidAt?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

/** A supplier's credit note against a bill: money taken off what is owed. */
export class CreditBillDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  amount!: number;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;

  /** The supplier's own credit note number. */
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(60)
  reference?: string;
}

export class VoidBillDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
