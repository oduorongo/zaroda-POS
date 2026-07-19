import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class LayawayLineItemInputDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateLayawayDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  customerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LayawayLineItemInputDto)
  lineItems!: LayawayLineItemInputDto[];
}
