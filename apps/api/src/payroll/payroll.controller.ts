import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PayrollProfilesService } from './payroll-profiles.service';
import { PayrollRunsService } from './payroll-runs.service';
import { SetPayrollProfileDto } from './dto/set-payroll-profile.dto';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts). Payroll
// touches pay rates and statutory numbers - restricted the same tier as
// discount/refund approval, not the routine cashier/front-desk tier.
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly profiles: PayrollProfilesService,
    private readonly runs: PayrollRunsService,
  ) {}

  @Get('profiles')
  findAllProfiles() {
    return this.profiles.findAll();
  }

  @Post('profiles/:orgUserId')
  setProfile(@Param('orgUserId') orgUserId: string, @Body() dto: SetPayrollProfileDto) {
    return this.profiles.set(orgUserId, dto);
  }

  @Patch('profiles/:orgUserId/deactivate')
  deactivateProfile(@Param('orgUserId') orgUserId: string) {
    return this.profiles.deactivate(orgUserId);
  }

  @Post('runs')
  createRun(@Body() dto: CreatePayrollRunDto) {
    return this.runs.create(dto);
  }

  @Get('runs')
  findAllRuns() {
    return this.runs.findAll();
  }

  @Get('runs/:id')
  findOneRun(@Param('id') id: string) {
    return this.runs.findOne(id);
  }

  @Post('runs/:id/generate')
  generateRun(@Param('id') id: string) {
    return this.runs.generate(id);
  }

  @Patch('runs/:id/approve')
  approveRun(@Param('id') id: string) {
    return this.runs.approve(id);
  }

  @Patch('runs/:id/mark-paid')
  markRunPaid(@Param('id') id: string) {
    return this.runs.markPaid(id);
  }
}
