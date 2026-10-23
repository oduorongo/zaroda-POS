import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const STATES = [
  'NEEDS_SETUP',
  'READY',
  'REGISTERED',
  'NEEDS_UPDATE',
  'REJECTED',
] as const;

export class UpdateEtimsItemDto {
  /** KRA's product classification code (from the downloaded list). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\d{1,10}$/, {
    message: "KRA's classification code is up to 10 digits",
  })
  itemClsCd?: string;

  /** 1 raw material, 2 finished product, 3 service. */
  @IsOptional()
  @IsIn(['1', '2', '3'])
  itemTyCd?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5)
  pkgUnitCd?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5)
  qtyUnitCd?: string;

  /** Overrides the tax type worked out from the product's tax class; null goes back to "from the tax class". */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['A', 'B', 'C', 'D', 'E'])
  taxTyCd?: string | null;
}

export class ClassifyItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  variantIds!: string[];

  @Transform(trim)
  @IsString()
  @Matches(/^\d{1,10}$/)
  itemClsCd!: string;
}

export class RegisterItemsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  variantIds?: string[];

  /** Everything that is ready or needs an update (up to 100 at a time). */
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

export class ItemListQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(STATES)
  state?: (typeof STATES)[number];

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;
}
