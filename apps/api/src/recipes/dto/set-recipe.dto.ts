import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  Min,
  IsNumber,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class RecipeIngredientDto {
  @IsUUID()
  ingredientVariantId!: string;

  // Consumed per 1 unit of the parent variant sold - e.g. 0.2 (kg) rice
  // per 1 Biryani. Whole or fractional depending on the ingredient
  // variant's own QuantityMode, checked in RecipesService.
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
}

export class SetRecipeDto {
  // Empty array is valid and meaningful - it clears the recipe, reverting
  // the variant to a plain stocked item (see RecipeIngredient's schema
  // comment). Deliberately no @ArrayMinSize(1).
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients!: RecipeIngredientDto[];

  /** Made in advance and kept in stock: the recipe is its bill of materials when it is made, and a sale takes the item itself. */
  @IsOptional()
  @IsBoolean()
  madeAhead?: boolean;

  /** Uniform makers: what a tailor is paid per piece of this size (null clears it). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tailorRate?: number | null;
}
