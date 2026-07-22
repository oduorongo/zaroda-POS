import { IsNumber, Min } from 'class-validator';

export class RecordCountDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQuantity!: number;
}
