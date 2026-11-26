import { Type } from 'class-transformer';
import { FarmSpecies } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class ValuationRateDto {
  @IsEnum(FarmSpecies)
  species!: FarmSpecies;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  birthValue!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerKg!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  primeAgeMonths!: number | null;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  ageDropRate!: number;
}

export class UpdateValuationSettingsDto {
  /** The margin on cost to date, 0.20 = 20%. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(5)
  margin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(730)
  productionDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ValuationRateDto)
  rates?: ValuationRateDto[];
}
