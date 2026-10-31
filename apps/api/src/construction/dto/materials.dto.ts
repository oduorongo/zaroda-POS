import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import { ConIssueKind, ConPlantOwnership, ConRateUnit } from '@prisma/client';

export class RequisitionLineDto {
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  qty!: number;

  @IsUUID()
  @IsOptional()
  bqItemId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  note?: string;
}

export class RequisitionDto {
  @IsDateString({ strict: true })
  @IsOptional()
  neededBy?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineDto)
  lines!: RequisitionLineDto[];
}

export class ReasonDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class LpoLineDto {
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  qty!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rate!: number;
}

export class LpoDto {
  @IsUUID()
  supplierId!: string;

  @IsUUID()
  @IsOptional()
  requisitionId?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  deliverBy?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LpoLineDto)
  lines!: LpoLineDto[];
}

export class GrnLineDto {
  @IsUUID()
  lineItemId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @IsOptional()
  damaged?: number;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  damagedNote?: string;
}

export class GrnDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  deliveryNote?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrnLineDto)
  lines!: GrnLineDto[];
}

export class IssueDto {
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  qty!: number;

  @IsEnum(ConIssueKind)
  @IsOptional()
  kind?: ConIssueKind;

  @IsUUID()
  @IsOptional()
  bqItemId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  issuedTo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  issuedAt?: string;
}

export class BudgetDto {
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  qty!: number;
}

export class PlantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  regNo?: string;

  @IsEnum(ConPlantOwnership)
  ownership!: ConPlantOwnership;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  hireRate?: number;

  @IsEnum(ConRateUnit)
  @IsOptional()
  rateUnit?: ConRateUnit;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsUUID()
  @IsOptional()
  projectId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class PlantLogDto {
  @IsUUID()
  plantId!: string;

  @IsDateString({ strict: true })
  date!: string;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(24)
  hours!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  fuelLitres?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  fuelCost?: number;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  operator?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}
