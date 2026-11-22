import { FarmAnimalSource, FarmBreedingKind, FarmCountReason, FarmHealthKind, FarmSex, FarmSpecies } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
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

const Day = () => IsDateString({ strict: true }, { message: 'Choose a date' });

export class CreateAnimalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  tag!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsEnum(FarmSpecies)
  species!: FarmSpecies;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  breed?: string;

  @IsEnum(FarmSex)
  sex!: FarmSex;

  @IsOptional()
  @Day()
  birthDate?: string;

  @IsOptional()
  @IsBoolean()
  birthEstimated?: boolean;

  @IsOptional()
  @IsUUID()
  damId?: string;

  @IsOptional()
  @IsUUID()
  sireId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sireCode?: string;

  @IsOptional()
  @IsEnum(FarmAnimalSource)
  source?: FarmAnimalSource;

  @IsOptional()
  @Day()
  boughtOn?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  boughtPrice?: number;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  enterpriseId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;
}

export class UpdateAnimalDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  breed?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  enterpriseId?: string;
}

export class ExitAnimalDto {
  @IsIn(['SOLD', 'DIED', 'SLAUGHTERED', 'CULLED', 'LOST'])
  status!: 'SOLD' | 'DIED' | 'SLAUGHTERED' | 'CULLED' | 'LOST';

  @Day()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  /** Buyer (sold) or slaughterhouse. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  party?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  permitNo?: string;
}

export class CreateGroupDto {
  @IsEnum(FarmSpecies)
  species!: FarmSpecies;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  breed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  purpose?: string;

  @Day()
  placedOn!: string;

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  headCount!: number;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  enterpriseId?: string;
}

export class GroupCountDto {
  @Day()
  date!: string;

  @IsEnum(FarmCountReason)
  reason!: FarmCountReason;

  /** How many (a positive number; ADJUSTED may be negative). */
  @IsInt()
  @Min(-10_000_000)
  @Max(10_000_000)
  count!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;
}

export class CreateDrugDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(365)
  milkWithdrawalDays!: number;

  @IsInt()
  @Min(0)
  @Max(365)
  meatWithdrawalDays!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  eggWithdrawalDays?: number;

  @IsOptional()
  @IsBoolean()
  prescriptionOnly?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class HealthEventDto {
  @IsOptional()
  @IsUUID()
  animalId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @Day()
  date!: string;

  @IsEnum(FarmHealthKind)
  kind!: FarmHealthKind;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  diagnosis?: string;

  @IsOptional()
  @IsUUID()
  drugId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  dose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  vetName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** The programme dose this records (closes its due task and schedules the next). */
  @IsOptional()
  @IsUUID()
  programmeId?: string;
}

export class VoidDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class ProgrammeDto {
  @IsEnum(FarmSpecies)
  species!: FarmSpecies;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsIn(['VACCINATED', 'DEWORMED', 'DIPPED'])
  kind!: 'VACCINATED' | 'DEWORMED' | 'DIPPED';

  @IsOptional()
  @IsUUID()
  drugId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  firstAgeDays?: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  intervalDays!: number;
}

export class OffspringDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  tag!: string;

  @IsEnum(FarmSex)
  sex!: FarmSex;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class BreedingEventDto {
  @IsUUID()
  animalId!: string;

  @Day()
  date!: string;

  @IsEnum(FarmBreedingKind)
  kind!: FarmBreedingKind;

  @IsOptional()
  @IsUUID()
  sireId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sireCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  inseminator?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  /** Births: the young, registered as new animals of the mother. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OffspringDto)
  offspring?: OffspringDto[];
}

export class WeightDto {
  @IsOptional()
  @IsUUID()
  animalId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @Day()
  date!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100_000)
  kg!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(5)
  bodyCondition?: number;
}

export class DueDoneDto {
  @Day()
  date!: string;
}
