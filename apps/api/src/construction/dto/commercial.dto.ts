import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ConReceiptKind } from '@prisma/client';

export class VariationDto {
  @IsUUID()
  @IsOptional()
  instructionId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description!: string;

  /** Priced amount; negative for an omission. Zero while not yet priced. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  amount!: number;
}

export class VariationDecisionDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  /** The architect / client's representative who approved it. */
  @IsString()
  @IsOptional()
  @MaxLength(120)
  approvedByName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}

export class ValuationLineDto {
  @IsUUID()
  @IsOptional()
  bqItemId?: string;

  @IsUUID()
  @IsOptional()
  variationId?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsOptional()
  qtyToDate?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  amountToDate?: number;
}

export class ValuationDto {
  @IsDateString({ strict: true })
  periodEnd!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  materialsOnSite?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  advanceRecovery?: number;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ValuationLineDto)
  lines!: ValuationLineDto[];
}

export class CertifyDto {
  /** Who certified it for the client (their QS). */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  certifiedByName!: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  certifiedRef?: string;

  @IsDateString({ strict: true })
  certifiedAt!: string;
}

export class ReceiptDto {
  @IsEnum(ConReceiptKind)
  kind!: ConReceiptKind;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsIn(['MPESA', 'BANK', 'CHEQUE', 'CASH'])
  @IsOptional()
  method?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  reference?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  certificateNo?: string;

  @IsDateString({ strict: true })
  receivedAt!: string;
}

export class RetentionReleaseDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  percent!: number;

  @IsIn(['PRACTICAL_COMPLETION', 'END_OF_DLP'])
  stage!: 'PRACTICAL_COMPLETION' | 'END_OF_DLP';
}

export class SubcontractDto {
  @IsUUID()
  partyId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  scope!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sum!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  retentionRate?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  retentionLimit?: number;
}

export class SubValuationDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  grossToDate!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class SubPaymentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  paymentRef!: string;
}
