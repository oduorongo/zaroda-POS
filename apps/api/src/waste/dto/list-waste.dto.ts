import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { WasteReason } from '@prisma/client';

export class ListWasteDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  variantId?: string;

  @IsEnum(WasteReason)
  @IsOptional()
  reason?: WasteReason;
}
