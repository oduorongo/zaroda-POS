import { IsUUID } from 'class-validator';

export class CreateStockTakeDto {
  @IsUUID()
  branchId!: string;
}
