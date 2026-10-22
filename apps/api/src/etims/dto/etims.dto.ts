import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EtimsEnvironment } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateEtimsSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(EtimsEnvironment)
  environment?: EtimsEnvironment;

  /** The business's KRA PIN. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  tin?: string;
}

export class ConnectDeviceDto {
  /** KRA's branch ID: two digits, "00" for the head office. */
  @Transform(trim)
  @IsString()
  @Matches(/^\d{2}$/, { message: 'The branch ID is two digits, like 00' })
  bhfId!: string;

  /** The device serial number KRA approved for this branch. */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  dvcSrlNo!: string;
}

export class ItemClassQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
