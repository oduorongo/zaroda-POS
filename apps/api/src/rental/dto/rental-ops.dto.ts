import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  MaxLength,
  IsBoolean,
} from 'class-validator';

export const EXPENSE_CATEGORIES = ['REPAIRS', 'UTILITIES', 'RATES_AND_TAXES', 'INSURANCE', 'CARETAKER', 'MANAGEMENT_FEE', 'OTHER'] as const;
export const MAINTENANCE_PRIORITIES = ['LOW', 'NORMAL', 'URGENT'] as const;
export const MAINTENANCE_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const METER_KINDS = ['WATER', 'ELECTRICITY'] as const;

export class CreateExpenseDto {
  @IsUUID()
  propertyId!: string;

  @IsUUID()
  @IsOptional()
  unitId?: string;

  @IsUUID()
  @IsOptional()
  maintenanceId?: string;

  @IsIn(EXPENSE_CATEGORIES)
  category!: (typeof EXPENSE_CATEGORIES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  vendor?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsDateString()
  @IsOptional()
  incurredAt?: string;
}

export class CreateMaintenanceDto {
  @IsUUID()
  propertyId!: string;

  @IsUUID()
  @IsOptional()
  unitId?: string;

  @IsUUID()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  @IsString()
  @MaxLength(1500)
  @IsOptional()
  description?: string;

  @IsIn(MAINTENANCE_PRIORITIES)
  @IsOptional()
  priority?: (typeof MAINTENANCE_PRIORITIES)[number];
}

export class UpdateMaintenanceDto {
  @IsIn(MAINTENANCE_STATUSES)
  @IsOptional()
  status?: (typeof MAINTENANCE_STATUSES)[number];

  @IsIn(MAINTENANCE_PRIORITIES)
  @IsOptional()
  priority?: (typeof MAINTENANCE_PRIORITIES)[number];

  @IsString()
  @MaxLength(1500)
  @IsOptional()
  description?: string;
}

export class RecordMeterReadingDto {
  @IsUUID()
  unitId!: string;

  @IsIn(METER_KINDS)
  kind!: (typeof METER_KINDS)[number];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reading!: number;

  @IsDateString()
  @IsOptional()
  readingDate?: string;

  // Price per unit (per m3 of water, per kWh). Defaults to the rate used on the previous reading.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  ratePerUnit?: number;

  // Only needed for the very first reading of a meter, to bill the first month's consumption.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  previousReading?: number;
}

export class UpdateReminderSettingsDto {
  @IsBoolean()
  @IsOptional()
  remindersEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  smsReminders?: boolean;

  // e.g. "Paybill 123456, account = your unit number". Shown to tenants in every reminder.
  @IsString()
  @MaxLength(300)
  @IsOptional()
  paymentInstructions?: string;
}

export class SendReminderDto {
  @IsUUID()
  leaseId!: string;
}
