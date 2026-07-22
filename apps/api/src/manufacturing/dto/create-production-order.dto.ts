import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateProductionOrderDto {
  @IsUUID()
  branchId!: string;

  // The finished good being produced - must have RecipeIngredient rows
  // (a BOM) set via the recipe editor, since completing the order reads
  // that BOM to know what raw materials to consume.
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  plannedQuantity!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
