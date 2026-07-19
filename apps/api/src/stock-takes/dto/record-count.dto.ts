import { IsInt, Min } from 'class-validator';

export class RecordCountDto {
  @IsInt()
  @Min(0)
  countedQuantity!: number;
}
