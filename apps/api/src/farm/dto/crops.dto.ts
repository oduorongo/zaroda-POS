import { FarmCropActivityKind, FarmCropStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const Day = () => IsDateString({ strict: true }, { message: 'Choose a date' });

export class CreateSeasonDto {
  @IsUUID()
  unitId!: string;

  @IsOptional()
  @IsUUID()
  enterpriseId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  crop!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  variety?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.01)
  @Max(100_000)
  acres!: number;

  @IsOptional()
  @Day()
  plantedOn?: string;

  @IsOptional()
  @Day()
  expectedHarvest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  seedSupplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  seedCertNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateSeasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  variety?: string;

  @IsOptional()
  @Day()
  plantedOn?: string;

  @IsOptional()
  @Day()
  expectedHarvest?: string;

  @IsOptional()
  @IsEnum(FarmCropStatus)
  status?: FarmCropStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  seedSupplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  seedCertNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CropActivityDto {
  @Day()
  date!: string;

  @IsEnum(FarmCropActivityKind)
  kind!: FarmCropActivityKind;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  product?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  rate?: string;

  /** A stock item used (fertiliser, chemical, seed); its quantity comes off stock. */
  @IsOptional()
  @IsUUID()
  inputVariantId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10_000_000)
  quantity?: number;

  /** What the inputs cost when the stock item has no cost, or when bought for this job. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  inputCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  workers?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  labourCost?: number;

  /** Days from the label before the crop may be harvested (pre-harvest interval). Required for spraying. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  preHarvestDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  doneBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class HarvestDto {
  @Day()
  date!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10_000_000)
  quantity!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100_000)
  kgPerUnit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  grade?: string;

  /** The POS product the harvest goes into as stock, counted in that product's unit. */
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10_000_000)
  stockQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
