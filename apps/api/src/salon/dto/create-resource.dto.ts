import { IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateResourceDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @MaxLength(100)
  name!: string;
}
