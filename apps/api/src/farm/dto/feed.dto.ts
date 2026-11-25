import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const Day = () => IsDateString({ strict: true }, { message: 'Choose a date' });

export class RationItemDto {
  @IsUUID()
  variantId!: string;

  /** In the ingredient's own unit (kg, or bags if it is stocked in bags). */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;
}

export class RationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  species?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  stage?: string;

  /** The finished feed product (per kg). Left out: a product named after the ration is made. */
  @IsOptional()
  @IsUUID()
  outputVariantId?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  @Max(1_000_000)
  batchKg!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => RationItemDto)
  items!: RationItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class FeedBatchDto {
  @IsUUID()
  rationId!: string;

  @Day()
  date!: string;

  /** How many times the recipe was mixed (2 = double). Ignored for any ingredient given in items. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.01)
  @Max(1000)
  batches?: number;

  /** What was really used, when it differs from the recipe. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => RationItemDto)
  items?: RationItemDto[];

  /** kg of feed weighed out. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.1)
  @Max(10_000_000)
  kgProduced!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class FeedingEntryDto {
  @IsOptional()
  @IsUUID()
  animalId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100_000)
  kg!: number;
}

/** A day's feeding: one line per group or animal fed. */
export class FeedingDto {
  @Day()
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FeedingEntryDto)
  entries!: FeedingEntryDto[];
}
