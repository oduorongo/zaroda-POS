import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SaveTailorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  idNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class MaterialsQueryDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  variantId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;
}

export class CreateTailorJobDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  tailorId!: string;

  @IsUUID()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  /** Defaults to the item's tailor rate. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ratePerPiece?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class HandInDto {
  @IsInt()
  @Min(0)
  goodQty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rejectedQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CloseJobDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class TailorPaymentDto {
  @IsUUID()
  tailorId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount!: number;

  @IsIn(['CASH', 'MPESA', 'BANK'])
  method!: 'CASH' | 'MPESA' | 'BANK';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  /** YYYY-MM-DD; today when left out. */
  @IsOptional()
  @IsDateString()
  paidOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class VoidPaymentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class JobsQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'DONE', 'CANCELLED'])
  status?: 'OPEN' | 'DONE' | 'CANCELLED';

  @IsOptional()
  @IsUUID()
  tailorId?: string;
}
