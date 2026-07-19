import { IsString, MaxLength, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
