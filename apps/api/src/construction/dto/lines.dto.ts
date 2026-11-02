import { Transform } from 'class-transformer';
import { ConClientMoveKind, ConCrossingKind, ConCrossingStatus, ConLineAssetKind, ConWayleaveStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class StaffLicenceDto {
  @IsUUID()
  orgUserId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(20)
  @IsOptional()
  body?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  licenceClass!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  licenceNo!: string;

  @IsDateString({ strict: true })
  expiresAt!: string;
}

export class SectionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10000)
  @IsOptional()
  fromKm?: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10000)
  @IsOptional()
  toKm?: number;

  @IsInt()
  @Min(0)
  @Max(1000000)
  @IsOptional()
  targetPoles?: number;

  @IsInt()
  @Min(0)
  @Max(1000000)
  @IsOptional()
  targetStays?: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10000)
  @IsOptional()
  targetConductorKm?: number;

  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  targetTransformers?: number;

  @IsInt()
  @Min(0)
  @Max(1000000)
  @IsOptional()
  targetServices?: number;
}

export class ProgressDto {
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  poles?: number;

  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  stays?: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1000)
  @IsOptional()
  conductorKm?: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  transformers?: number;

  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  services?: number;

  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  crew?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}

export class ProgressQueryDto {
  @IsDateString({ strict: true })
  @IsOptional()
  from?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  to?: string;
}

export class WayleaveDto {
  @IsUUID()
  @IsOptional()
  sectionId?: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  landowner!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(20)
  @IsOptional()
  phone?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(60)
  @IsOptional()
  parcelNo?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10000)
  @IsOptional()
  chainageKm?: number;

  @IsEnum(ConWayleaveStatus)
  @IsOptional()
  status?: ConWayleaveStatus;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  compensation?: number;

  @IsDateString({ strict: true })
  @IsOptional()
  agreedAt?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}

export class CrossingDto {
  @IsUUID()
  @IsOptional()
  sectionId?: string;

  @IsEnum(ConCrossingKind)
  kind!: ConCrossingKind;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  authority!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(60)
  @IsOptional()
  refNo?: string;

  @IsEnum(ConCrossingStatus)
  @IsOptional()
  status?: ConCrossingStatus;

  @IsDateString({ strict: true })
  @IsOptional()
  approvedAt?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  expiresAt?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}

export class LineAssetDto {
  @IsUUID()
  @IsOptional()
  sectionId?: string;

  @IsEnum(ConLineAssetKind)
  kind!: ConLineAssetKind;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  tag!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(60)
  @IsOptional()
  serialNo?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  spec?: string;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  @IsOptional()
  lat?: number;

  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  @IsOptional()
  lng?: number;

  @IsDateString({ strict: true })
  @IsOptional()
  installedAt?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  @IsOptional()
  note?: string;
}

export class ClientItemDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  description!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit!: string;
}

export class ClientMoveDto {
  @IsUUID()
  itemId!: string;

  @IsEnum(ConClientMoveKind)
  kind!: ConClientMoveKind;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10_000_000)
  quantity!: number;

  @IsUUID()
  @IsOptional()
  sectionId?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  moveDate?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(60)
  @IsOptional()
  reference?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  @IsOptional()
  note?: string;
}

export class LineFileKindDto {
  @IsIn(['wayleaves', 'crossings'])
  kind!: 'wayleaves' | 'crossings';
}
