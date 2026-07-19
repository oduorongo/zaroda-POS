import {
  IsInt,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateTableDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @MaxLength(50)
  label!: string;

  @IsInt()
  @IsPositive()
  seats!: number;
}
