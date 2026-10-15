import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { RentalBillingCycle, RentalPlanCode } from '../rental-plans.util';

export class ChangePlanDto {
  @IsIn(['bure', 'starter', 'collect'])
  plan!: RentalPlanCode;

  @IsOptional()
  @IsIn(['monthly', 'annual'])
  billingCycle?: RentalBillingCycle;
}

export class SetCaretakerPropertiesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  propertyIds!: string[];
}
