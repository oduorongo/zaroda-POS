import { FarmEnterpriseKind, FarmRoleCode, FarmUnitKind } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateFarmSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  farmName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  county?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  subCounty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  ward?: string;
}

export class CreateFarmUnitDto {
  @IsEnum(FarmUnitKind)
  kind!: FarmUnitKind;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Land area; only fields and paddocks count toward the plan's acres. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  acres?: number;

  /** Animals or birds the unit holds. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateFarmUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  acres?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateFarmEnterpriseDto {
  @IsEnum(FarmEnterpriseKind)
  kind!: FarmEnterpriseKind;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  unitIds?: string[];
}

export class UpdateFarmEnterpriseDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  unitIds?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SetFarmRolesDto {
  @IsArray()
  @ArrayMaxSize(9)
  @IsEnum(FarmRoleCode, { each: true })
  roles!: FarmRoleCode[];

  /** Limit the person to these units; empty = the whole farm. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  unitIds?: string[];
}
