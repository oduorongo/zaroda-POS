import { IsNumber, IsUUID, Min } from 'class-validator';

export class OpenShiftDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  terminalId!: string;

  @IsNumber()
  @Min(0)
  openingFloat!: number;
}
