import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePropertyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  address?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}

export class UpdatePropertyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  address?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}

export class CreateUnitDto {
  @IsUUID()
  propertyId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyRent!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  depositAmount?: number;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}

export class BulkCreateUnitsDto {
  @IsUUID()
  propertyId!: string;

  // One entry per unit, e.g. ["A1", "A2", "A3"]. Labels the property already has are skipped, not failed.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  labels!: string[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyRent!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  depositAmount?: number;
}

export class UpdateUnitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @IsOptional()
  label?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  monthlyRent?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  depositAmount?: number;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  // Optional: put the new tenant straight into a vacant unit (the lease is created in the same step).
  @IsUUID()
  @IsOptional()
  unitId?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsInt()
  @Min(1)
  @Max(28)
  @IsOptional()
  dueDay?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  monthlyRent?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  depositAmount?: number;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  idNumber?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}

export class UpdateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  idNumber?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}

export class CreateLeaseDto {
  @IsUUID()
  unitId!: string;

  @IsUUID()
  tenantId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  // Defaults to the unit's listed rent / deposit when omitted.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  monthlyRent?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  depositAmount?: number;

  // Day of the month rent falls due. Capped at 28 so it exists in every month.
  @IsInt()
  @Min(1)
  @Max(28)
  @IsOptional()
  dueDay?: number;
}

export class EndLeaseDto {
  @IsDateString()
  @IsOptional()
  endedAt?: string;
}
