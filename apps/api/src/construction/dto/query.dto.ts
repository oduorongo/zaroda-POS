import { IsISO8601, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class ReportQueryDto {
  @IsUUID()
  @IsOptional()
  projectId?: string;

  @Matches(DAY, { message: 'from must be a date like 2026-10-31' })
  @IsOptional()
  from?: string;

  @Matches(DAY, { message: 'to must be a date like 2026-10-31' })
  @IsOptional()
  to?: string;

  /** xlsx downloads a spreadsheet; print is the same table for the printable (PDF) page. Both need full reports. */
  @IsIn(['xlsx', 'print'])
  @IsOptional()
  format?: 'xlsx' | 'print';
}

/** Long lists: ?take=&skip= (newest first). */
export class PageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  take?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  skip?: number;
}

export const pageOf = (q?: PageQueryDto, fallback = 200) => ({ take: q?.take ?? fallback, skip: q?.skip ?? 0 });

export class DiaryQueryDto extends PageQueryDto {
  @Matches(DAY, { message: 'from must be a date like 2026-10-31' })
  @IsOptional()
  from?: string;

  @Matches(DAY, { message: 'to must be a date like 2026-10-31' })
  @IsOptional()
  to?: string;
}

export class WorkersQueryDto extends PageQueryDto {
  @IsUUID()
  @IsOptional()
  projectId?: string;
}

export class MusterRangeQueryDto {
  @Matches(DAY, { message: 'from must be a date like 2026-10-31' })
  from!: string;

  @Matches(DAY, { message: 'to must be a date like 2026-10-31' })
  to!: string;
}

export class PhotoQueryDto {
  @IsString()
  @MaxLength(300)
  @IsOptional()
  caption?: string;

  @IsLatitude()
  @IsOptional()
  lat?: string;

  @IsLongitude()
  @IsOptional()
  lng?: string;

  @IsISO8601()
  @IsOptional()
  takenAt?: string;
}

export class MusterDayQueryDto {
  @Matches(DAY, { message: 'date must be a date like 2026-10-31' })
  @IsOptional()
  date?: string;
}
