import { FarmMilkSession, FarmMilkUse } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const Day = () => IsDateString({ strict: true }, { message: 'Choose a date' });

export class ProduceSettingsDto {
  @IsOptional()
  @IsUUID()
  milkVariantId?: string | null;

  @IsOptional()
  @IsUUID()
  eggVariantId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(360)
  eggsPerUnit?: number;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;
}

export class MilkEntryDto {
  @IsOptional()
  @IsUUID()
  animalId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(200)
  litres!: number;

  @IsEnum(FarmMilkUse)
  use!: FarmMilkUse;
}

/** One milking: litres for each cow (or group) milked in that session. */
export class MilkSessionDto {
  @Day()
  date!: string;

  @IsEnum(FarmMilkSession)
  session!: FarmMilkSession;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MilkEntryDto)
  entries!: MilkEntryDto[];
}

export class EggRecordDto {
  @IsUUID()
  groupId!: string;

  @Day()
  date!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  goodEggs!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  cracked?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  small?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  feedKg?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  deaths?: number;
}

export class ProduceRecordDto {
  @IsOptional()
  @IsUUID()
  enterpriseId?: string;

  @Day()
  date!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  product!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10_000_000)
  quantity!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
