import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DiscountInputDto,
  SalePaymentInputDto,
} from '../../sales/dto/create-sale.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class OpenTabDto {
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  guestCount?: number;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  notes?: string;
}

export class AddTabLineDto {
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(1000)
  quantity!: number;

  /** Left out, the dish's own station is used (Tables & Kitchen setup), else the branch's first station. */
  @IsUUID()
  @IsOptional()
  stationId?: string;

  /** 1 = sent to the kitchen now; higher courses wait until fired. */
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  courseNumber?: number;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  notes?: string;
}

export class AddTabLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AddTabLineDto)
  lines!: AddTabLineDto[];
}

export class VoidTabLineDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export class MoveTabDto {
  @IsUUID()
  tableId!: string;
}

export class CancelTabDto {
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  reason?: string;
}

/** Everything one payer's payment needs (the same shape the single close and each payer of a split use). */
export class PayerDto {
  /** Client-generated; sending the same one twice returns the same sale instead of charging twice. */
  @IsUUID()
  clientId!: string;

  /** Which items this payment covers. Left out, everything still unpaid. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  @IsOptional()
  lineIds?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentInputDto)
  payments!: SalePaymentInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountInputDto)
  discount?: DiscountInputDto;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  redeemPoints?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  @IsOptional()
  tipAmount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  @IsOptional()
  serviceChargeAmount?: number;

  /** Who this payment is for, e.g. "Wanjiru" - printed on nothing, only kept with the tab. */
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  @IsOptional()
  label?: string;
}

export class CloseTabDto extends PayerDto {
  @IsUUID()
  terminalId!: string;

  @IsUUID()
  cashierSessionId!: string;

  @IsUUID()
  @IsOptional()
  shiftId?: string;
}

export class CloseSplitDto {
  @IsUUID()
  terminalId!: string;

  @IsUUID()
  cashierSessionId!: string;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PayerDto)
  payers!: PayerDto[];
}

export class BillQueryDto {
  /** Show what each of N people would pay if the bill is split equally. */
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  @IsOptional()
  split?: number;

  /** A comma-separated list of item ids: the bill for just those. */
  @Matches(/^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36})*$/, {
    message: 'lineIds must be a comma-separated list of ids',
  })
  @IsOptional()
  lineIds?: string;
}

export class UpdateTableDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @IsOptional()
  label?: string;

  @IsInt()
  @IsPositive()
  @Max(500)
  @IsOptional()
  seats?: number;
}

export class UpdateStationDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;
}

export class RestaurantSettingsDto {
  @IsUUID()
  branchId!: string;

  @IsInt()
  @Min(0)
  @Max(720)
  reserveLeadMinutes!: number;
}
