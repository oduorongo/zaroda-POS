import { Transform } from 'class-transformer';
import { FarmInputKind } from '@prisma/client';
import { IsEnum, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateFarmInputDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsEnum(FarmInputKind)
  kind!: FarmInputKind;

  /** What it is counted in: bag, kg, litre, packet, tray... */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit!: string;

  /** COUNT for whole bags and packets; WEIGHT for kg or litres that can be part-used. */
  @IsIn(['COUNT', 'WEIGHT'])
  mode!: 'COUNT' | 'WEIGHT';

  /** What one unit costs (KES). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost!: number;
}

export class MarkFarmInputDto {
  @IsUUID()
  productId!: string;

  /** The kind of input; null puts it back with the farm's products. */
  @IsOptional()
  @IsEnum(FarmInputKind)
  kind!: FarmInputKind | null;
}

export class ReceiveFarmInputDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  /** What was paid for one unit (KES); left out, the item's cost price is used. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** The supplier's delivery note or receipt number. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  deliveryNote?: string;
}
