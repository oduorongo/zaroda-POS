import { IsNumber, Min } from 'class-validator';

export class CloseShiftDto {
  /** What the cashier physically counted in the drawer at close-out. */
  @IsNumber()
  @Min(0)
  countedCash!: number;
}
