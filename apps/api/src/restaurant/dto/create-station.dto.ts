import { IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateStationDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @MaxLength(50)
  name!: string;
}
