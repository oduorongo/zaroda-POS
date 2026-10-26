import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RegisterTenderBuyerDto {
  /** The school's name. */
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  @IsString()
  @MaxLength(30)
  phone!: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(200)
  email?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  county!: string;

  @IsString()
  @MaxLength(10)
  pin!: string;
}

export class TenderBuyerLoginDto {
  @IsString()
  @MaxLength(30)
  phone!: string;

  @IsString()
  @MaxLength(10)
  pin!: string;
}

export class AdvertItemDto {
  @IsString()
  @MaxLength(200)
  description!: string;

  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  unit?: string;
}

export class SaveTenderAdvertDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  reference?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(150)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  description!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  county!: string;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AdvertItemDto)
  @IsOptional()
  items?: AdvertItemDto[];

  /** How to get the full tender documents. */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  documentsInfo?: string;

  @IsDateString({ strict: true })
  closingDate!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  @IsString()
  @MaxLength(30)
  contactPhone!: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(200)
  contactEmail?: string;
}

export class TenderBoardQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(80)
  q?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  county?: string;

  /** NEW, SAVED, SEEN or DISMISSED; left out = everything not dismissed. */
  @IsIn(['NEW', 'SAVED', 'SEEN', 'DISMISSED'])
  @IsOptional()
  show?: 'NEW' | 'SAVED' | 'SEEN' | 'DISMISSED';

  /** Include adverts that have already closed (last 30 days). */
  @IsIn(['true', 'false'])
  @IsOptional()
  closed?: string;
}

export class TenderNoticeDto {
  @IsIn(['SEEN', 'SAVED', 'DISMISSED'])
  state!: 'SEEN' | 'SAVED' | 'DISMISSED';
}

export class AdminDecisionDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

export class AdminAdvertRemoveDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class AdminBuyerStatusDto {
  @IsIn(['APPROVED', 'SUSPENDED'])
  status!: 'APPROVED' | 'SUSPENDED';

  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

