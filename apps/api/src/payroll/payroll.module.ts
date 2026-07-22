import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollProfilesService } from './payroll-profiles.service';
import { PayrollRunsService } from './payroll-runs.service';

/**
 * Core, not industry-gated (every tenant has staff regardless of
 * vertical) - unlike restaurant/salon/manufacturing/service-jobs, this
 * isn't registered with ModuleRegistryService because it isn't opt-in at
 * the organization level, only per-employee (see PayrollProfile's schema
 * comment).
 */
@Module({
  controllers: [PayrollController],
  providers: [PayrollProfilesService, PayrollRunsService],
})
export class PayrollModule {}
