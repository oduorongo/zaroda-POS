import {
  IsBooleanString,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

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

export class SetLowStockThresholdDto {
  // 0 means "not tracked" - see InventoryTransactionsService.syncLowStockAlert.
  @IsInt()
  @Min(0)
  lowStockThreshold!: number;
}

export class ListLowStockAlertsDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  // Defaults to OPEN-only in the service - pass "false" to include resolved
  // alerts in the history view.
  @IsBooleanString()
  @IsOptional()
  includeResolved?: string;
}

export class ListConflictsDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
