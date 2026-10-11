import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// Deliberately no addonActive / commissionRate here - those are set only
// by a platform admin (see the OnlineStore schema comment). The global
// ValidationPipe (forbidNonWhitelisted, main.ts) rejects a request that
// sends them anyway.
export class UpdateOnlineStoreDto {
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  // Format checked in the service (normalizeSlug) so the error message can
  // explain the rules rather than just "invalid".
  @IsString()
  @IsOptional()
  @MaxLength(60)
  slug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  displayName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  contactPhone?: string;

  @IsUUID()
  @IsOptional()
  fulfilmentBranchId?: string;

  @IsBoolean()
  @IsOptional()
  pickupEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  deliveryEnabled?: boolean;
}

/** Connecting TUMA is its own request so credentials are verified with TUMA before anything is saved. */
export class ConnectTumaDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  apiKey!: string;
}
