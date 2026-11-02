import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ConIncidentSeverity, ConInstructionStatus, ConMusterStatus, ConWorkPermitType } from '@prisma/client';

export class DiaryDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  weather?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  worksDone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  delays?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  visitors?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  plantOnSite?: string;

  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  labourCount?: number;
}

export class InstructionDto {
  @IsUUID()
  @IsOptional()
  partyId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  issuedByName?: string;

  @IsDateString({ strict: true })
  date!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  description!: string;
}

export class InstructionStatusDto {
  @IsEnum(ConInstructionStatus)
  status!: ConInstructionStatus;
}

export class WorkerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  idNo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  trade!: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  ncaCardNo?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  ncaExpiresAt?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  dailyRate!: number;

  @IsBoolean()
  @IsOptional()
  isSupervisor?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsUUID()
  @IsOptional()
  projectId?: string;
}

export class MusterEntryDto {
  @IsUUID()
  workerId!: string;

  @IsEnum(ConMusterStatus)
  status!: ConMusterStatus;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(24)
  @IsOptional()
  hours?: number;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  clientRef?: string;
}

export class MusterDto {
  @IsDateString({ strict: true })
  date!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MusterEntryDto)
  entries!: MusterEntryDto[];
}

export class ToolboxTalkDto {
  @IsDateString({ strict: true })
  date!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  topic!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  attendeeIds!: string[];
}

export class PpeIssueDto {
  @IsUUID()
  workerId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  item!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  qty?: number;

  @IsDateString({ strict: true })
  issuedAt!: string;
}

export class WorkPermitDto {
  @IsEnum(ConWorkPermitType)
  type!: ConWorkPermitType;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  location!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  precautions?: string;

  @IsDateString()
  validFrom!: string;

  @IsDateString()
  validTo!: string;
}

export class IncidentDto {
  @IsDateString()
  occurredAt!: string;

  @IsEnum(ConIncidentSeverity)
  severity!: ConIncidentSeverity;

  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  description!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  actionTaken?: string;

  @IsUUID()
  @IsOptional()
  workerId?: string;
}

export class DoshsReportDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  doshsRef!: string;

  @IsDateString()
  @IsOptional()
  reportedAt?: string;
}
