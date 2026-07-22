import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateServiceJobDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  // Free text asset reference this job is against - a vehicle plate for a
  // garage, a route/run reference for a transport business. Generic on
  // purpose so this one job model serves both.
  @IsString()
  @IsOptional()
  @MaxLength(200)
  assetLabel?: string;

  @IsString()
  @MaxLength(2000)
  description!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
