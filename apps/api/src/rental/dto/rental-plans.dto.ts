import { IsIn, IsOptional } from 'class-validator';
import { RentalBillingCycle, RentalPlanCode } from '../rental-plans.util';

export class ChangePlanDto {
  @IsIn(['bure', 'starter', 'collect'])
  plan!: RentalPlanCode;

  @IsOptional()
  @IsIn(['monthly', 'annual'])
  billingCycle?: RentalBillingCycle;
}
