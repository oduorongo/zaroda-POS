import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A restaurant order's own richer line-item shape - variantId/quantity
 * (what core's SalesService.create() needs) plus stationId/courseNumber/
 * notes (what only this module needs, for kitchen routing). Kept
 * separate from core's SaleLineItemInputDto rather than adding these
 * fields there - a plain retail sale has no stations or courses, so
 * core's DTO shouldn't carry fields only this vertical uses.
 * RestaurantSalesService derives core's plain lineItems array from this
 * before calling SalesService.create().
 */
export class TableOrderLineItemDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsUUID()
  stationId!: string;

  // 1 = first course (fired immediately). Anything higher is held until
  // explicitly fired via POST /restaurant/tables/:tableId/courses/:n/fire.
  @IsInt()
  @Min(1)
  @IsOptional()
  courseNumber?: number;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  notes?: string;
}
