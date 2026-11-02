import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class BuyExtraProjectsDto {
  @IsInt()
  @Min(1)
  @Max(20)
  count!: number;

  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class RemoveExtraProjectsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;
}

export class BuySmsDto {
  @IsString()
  @MaxLength(40)
  bundleCode!: string;

  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class PayFeesDto {
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class SmsBundleDto {
  @Matches(/^[A-Za-z0-9_]{2,40}$/, { message: 'code: letters, numbers and _ only' })
  code!: string;

  @IsString()
  @MaxLength(80)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  sms!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  price!: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0)
  @Max(1000)
  @IsOptional()
  sortOrder?: number;
}

export class FeeBandDto {
  /** Leave out (or null) for the open-ended top band. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @IsOptional()
  upTo?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000)
  darajaCost!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000)
  markup!: number;
}

export class FeeBandsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => FeeBandDto)
  bands!: FeeBandDto[];
}
