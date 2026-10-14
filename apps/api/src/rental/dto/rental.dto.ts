import {
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
