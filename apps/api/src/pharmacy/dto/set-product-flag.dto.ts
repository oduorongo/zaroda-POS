import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetProductFlagDto {
  @IsBoolean()
  isControlledSubstance!: boolean;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  schedule?: string;
}
