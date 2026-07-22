import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateRepackagingDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  fromVariantId!: string;

  // How many bulk units to break down - e.g. 1 jerrycan. Whole or
  // fractional depending on the source variant's QuantityMode.
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  fromQuantity!: number;

  @IsUUID()
  toVariantId!: string;

  // Total resale units produced from fromQuantity bulk units - e.g. 100
  // scoops from 1 jerrycan, or 12.5kg of loose rice from a 50kg sack sold
  // by weight. Given explicitly per operation rather than a fixed ratio
  // stored on the product, since the actual yield of a bulk container
  // varies delivery to delivery.
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  toQuantity!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
