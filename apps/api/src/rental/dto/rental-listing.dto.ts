import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const LISTING_UNIT_TYPES = [
  'BEDSITTER',
  'SINGLE_ROOM',
  'ONE_BEDROOM',
  'TWO_BEDROOM',
  'THREE_BEDROOM',
  'SHOP',
  'OFFICE',
  'OTHER',
] as const;
export type ListingUnitType = (typeof LISTING_UNIT_TYPES)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Create or replace the advert for one vacant unit. */
export class UpsertListingDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title!: string;

  @IsIn(LISTING_UNIT_TYPES)
  unitType!: ListingUnitType;

  /** Estate or town shown to the public. The building's exact address is never published. */
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  area!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100_000_000)
  monthlyRent!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  depositAmount!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  contactName?: string;

  /** Called and messaged on WhatsApp by house-hunters. */
  @Transform(trim)
  @Matches(/^\+?[0-9 ]{9,15}$/, { message: 'Enter a phone number such as 0712 345 678' })
  contactPhone!: string;
}

export class SetListingActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class PayListingDto {
  /** The M-Pesa number that gets the prompt. */
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  phone!: string;
}

/** Pay once for several adverts. */
export class PayListingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  listingIds!: string[];

  @Transform(trim)
  @IsString()
  @MaxLength(20)
  phone!: string;
}

/** Why ZARODA is taking an advert down - shown to the landlord. */
export class BlockListingDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
