import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTerminalDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  deviceLabel!: string;
}

export class UpdateTerminalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsOptional()
  deviceLabel?: string;
}
