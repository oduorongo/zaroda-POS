import { FarmBuyerKind, FarmBuyerPayMethod, FarmMilkSession } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const Day = () => IsDateString({ strict: true }, { message: 'Choose a date' });

export class BuyerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsEnum(FarmBuyerKind)
  kind?: FarmBuyerKind;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  kraPin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  memberNo?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  creditLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  termsDays?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class DeliveryDto {
  @IsUUID()
  buyerId!: string;

  @Day()
  date!: string;

  @IsOptional()
  @IsEnum(FarmMilkSession)
  session?: FarmMilkSession;

  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10_000_000)
  quantity!: number;

  /** Price per unit; left out, the product's price. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  slipNo?: string;
}

export class BuyerPaymentDto {
  @IsUUID()
  buyerId!: string;

  @Day()
  date!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000_000)
  amount!: number;

  @IsEnum(FarmBuyerPayMethod)
  method!: FarmBuyerPayMethod;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class ProductTagDto {
  @IsUUID()
  variantId!: string;

  /** null removes the tag. */
  @IsOptional()
  @IsUUID()
  enterpriseId?: string | null;
}

export class ProductTagsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ProductTagDto)
  tags!: ProductTagDto[];
}
