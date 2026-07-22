import { IsNumber, IsPositive } from 'class-validator';

export class CompleteProductionOrderDto {
  // The real yield - can differ from plannedQuantity (spoilage, an
  // over-run). Ingredient consumption scales off this number, not the
  // planned one, so the BOM is charged against what actually came out.
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  actualQuantity!: number;
}
