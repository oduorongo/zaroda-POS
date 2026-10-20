import { RiderStatus, VehicleType } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RequestRiderCodeDto {
  @IsEmail({}, { message: 'Enter a valid email address, e.g. you@example.com' })
  @MaxLength(200)
  email!: string;
}

export class VerifyRiderCodeDto {
  @IsEmail({}, { message: 'Enter a valid email address, e.g. you@example.com' })
  @MaxLength(200)
  email!: string;

  @Matches(/^\s*\d{6}\s*$/, { message: 'Enter the 6-digit code from the email' })
  code!: string;
}

const PIN_MESSAGE = 'Your PIN must be 4 to 6 digits';

/** Self sign-up and sign-in by phone number and PIN: works on every network, no email needed. */
export class RiderSignupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fullName!: string;

  @IsString()
  @MaxLength(20)
  phone!: string;

  @Matches(/^\d{4,6}$/, { message: PIN_MESSAGE })
  pin!: string;
}

export class RiderPinLoginDto {
  @IsString()
  @MaxLength(20)
  phone!: string;

  @Matches(/^\d{4,6}$/, { message: PIN_MESSAGE })
  pin!: string;
}

export class RiderPhoneDto {
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class RiderPinResetDto {
  @IsString()
  @MaxLength(20)
  phone!: string;

  @Matches(/^\s*\d{6}\s*$/, { message: 'Enter the 6-digit code from the text message' })
  code!: string;

  @Matches(/^\d{4,6}$/, { message: PIN_MESSAGE })
  pin!: string;
}

/** A signed-in rider choosing (or changing) their own PIN. */
export class SetRiderPinDto {
  @Matches(/^\d{4,6}$/, { message: PIN_MESSAGE })
  pin!: string;
}

/** A rider editing their own profile - every field optional, only the ones sent change. */
export class UpdateRiderProfileDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(80)
  fullName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsEnum(VehicleType)
  @IsOptional()
  vehicleType?: VehicleType;

  @IsString()
  @IsOptional()
  @MaxLength(15)
  plateNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  area?: string;
}

/** A business adding one of its own riders: everything needed to approve them on the spot. */
export class CreateShopRiderDto {
  // Optional: the rider signs in with their phone number and a PIN, which we generate and show once.
  @IsEmail({}, { message: 'Enter a valid email address, e.g. rider@example.com' })
  @IsOptional()
  @MaxLength(200)
  email?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fullName!: string;

  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsEnum(VehicleType)
  vehicleType!: VehicleType;

  @IsString()
  @IsOptional()
  @MaxLength(15)
  plateNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  area?: string;
}

export class SetRiderStatusDto {
  @IsIn([RiderStatus.APPROVED, RiderStatus.SUSPENDED])
  status!: 'APPROVED' | 'SUSPENDED';
}

export class ListRidersQueryDto {
  @IsEnum(RiderStatus)
  @IsOptional()
  status?: RiderStatus;
}
