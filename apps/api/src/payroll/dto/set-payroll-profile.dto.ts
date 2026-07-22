import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { PayType } from '@prisma/client';

export class SetPayrollProfileDto {
  @IsIn(['SALARY', 'HOURLY'] satisfies PayType[])
  payType!: PayType;

  // Required for SALARY, ignored for HOURLY - cross-checked against
  // payType in PayrollProfilesService rather than here, same reasoning as
  // the discount type/value cross-check in CreateSaleDto.
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @IsOptional()
  baseSalary?: number;

  // Required for HOURLY, ignored for SALARY.
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @IsOptional()
  hourlyRate?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  kraPin?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  nssfNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  shifNumber?: string;
}
