import { FarmMusterStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const Day = () => IsDateString({ strict: true }, { message: 'Choose a date' });

export class WorkerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  idNumber?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100_000)
  dailyRate!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  unitIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class MusterEntryDto {
  @IsUUID()
  workerId!: string;

  @IsEnum(FarmMusterStatus)
  status!: FarmMusterStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  task?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  enterpriseId?: string;
}

export class MusterDto {
  @Day()
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MusterEntryDto)
  entries!: MusterEntryDto[];
}

export class WageRunDto {
  @Day()
  periodStart!: string;

  @Day()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
