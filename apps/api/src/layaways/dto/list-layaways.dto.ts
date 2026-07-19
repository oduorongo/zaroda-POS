import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { LayawayStatus } from '@prisma/client';

export class ListLayawaysDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsEnum(LayawayStatus)
  @IsOptional()
  status?: LayawayStatus;
}
