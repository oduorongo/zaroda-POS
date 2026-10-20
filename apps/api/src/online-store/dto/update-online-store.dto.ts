import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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

  // Counties the shop delivers to (checked against the 47 counties in the service). Empty = its own branch's county.
  @IsArray()
  @ArrayMaxSize(47)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @IsOptional()
  deliveryCounties?: string[];
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

/** Connecting the business's OWN M-Pesa (Safaricom Daraja) is its own request so the key and secret are checked with Safaricom before anything is saved. */
export class ConnectMpesaDto {
  @IsIn(['PAYBILL', 'TILL'])
  accountType!: 'PAYBILL' | 'TILL';

  // Paybill number, or for a Till the store (head office) number Daraja signs with.
  @Matches(/^\d{5,8}$/, { message: 'Enter the shortcode as 5 to 8 digits' })
  shortcode!: string;

  // A Till's own number (where the money lands). Required when accountType is TILL.
  @IsOptional()
  @Matches(/^\d{5,8}$/, { message: 'Enter the till number as 5 to 8 digits' })
  tillNumber?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  consumerKey!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  consumerSecret!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(300)
  passkey!: string;

  @IsIn(['production', 'sandbox'])
  environment!: 'production' | 'sandbox';
}

/** Which connected gateway buyers pay through. */
export class SetGatewayDto {
  @IsIn(['TUMA', 'DARAJA'])
  gateway!: 'TUMA' | 'DARAJA';
}
