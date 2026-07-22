import { Type } from 'class-transformer';
import {
  IsArray,
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
}
