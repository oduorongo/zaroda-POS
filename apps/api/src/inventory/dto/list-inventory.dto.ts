import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';

export class ListInventoryItemsDto {
  @IsUUID()
  branchId!: string;

  /** Query strings arrive as strings - IsBooleanString accepts "true"/"false" and the controller parses it. */
  @IsBooleanString()
  @IsOptional()
  lowStockOnly?: string;
}

export class ListInventoryTransactionsDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  variantId?: string;
}
