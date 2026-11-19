import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const TOP_UP_FROM = ['CASH', 'MPESA', 'BANK'] as const;

export class CreateBoxDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** What the box is kept topped up to; the first top-up puts it in. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  floatAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  holderName?: string;

  /** Where the opening float came from. */
  @IsIn(TOP_UP_FROM)
  from!: (typeof TOP_UP_FROM)[number];
}

export class UpdateBoxDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  floatAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  holderName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PayDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  /** One of the expense categories. */
  @IsString()
  category!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  description!: string;

  /** Who took the money (the boda rider, the cleaner...). */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  receivedBy!: string;

  /** YYYY-MM-DD; today when left out. */
  @IsOptional()
  @IsDateString({ strict: true })
  occurredOn?: string;

  /** VAT in the amount, with the seller's KRA PIN and eTIMS invoice number, so it can be claimed. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @Matches(/^[A-Za-z]\d{9}[A-Za-z]$/, { message: 'A KRA PIN looks like A123456789B' })
  supplierPin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  kraInvoiceNo?: string;
}

export class TopUpDto {
  /** Leave out to bring the box back to its float. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount?: number;

  @IsIn(TOP_UP_FROM)
  from!: (typeof TOP_UP_FROM)[number];

  @IsOptional()
  @IsDateString({ strict: true })
  occurredOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class CountDto {
  /** The cash actually in the box. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  counted!: number;

  @IsOptional()
  @IsDateString({ strict: true })
  occurredOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class VoidEntryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

/** ZARODA's own petty cash: a payment is charged straight to one of ZARODA's cost accounts. */
export class PlatformPettyPayDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  @IsUUID()
  accountId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  description!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  receivedBy!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  occurredOn?: string;
}

export class BookQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}
