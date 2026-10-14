import { IsEmail, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RequestTenantCodeDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;
}

export class VerifyTenantCodeDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'The code is 6 digits' })
  code!: string;
}

export class PortalPayDto {
  @IsUUID()
  leaseId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(500000)
  amount!: number;

  // Defaults to the phone number the landlord has on file for the tenant.
  @IsString()
  @MaxLength(20)
  @IsOptional()
  phone?: string;
}

export class PortalMaintenanceDto {
  @IsUUID()
  leaseId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  @IsString()
  @MaxLength(1500)
  @IsOptional()
  description?: string;
}
