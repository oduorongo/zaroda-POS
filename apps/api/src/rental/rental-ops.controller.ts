import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  CreateExpenseDto,
  CreateMaintenanceDto,
  RecordMeterReadingDto,
  SendReminderDto,
  UpdateMaintenanceDto,
  UpdateReminderSettingsDto,
} from './dto/rental-ops.dto';
import { RentalOpsService } from './rental-ops.service';
import { RentalRemindersService } from './rental-reminders.service';
import { RentalReportService } from './rental-report.service';

/** Running the properties: expenses, maintenance, meters, reminders and the monthly report. Managers and owners only. */
@Controller('rental')
@Roles(Role.MANAGER, Role.OWNER)
export class RentalOpsController {
  constructor(
    private readonly ops: RentalOpsService,
    private readonly reports: RentalReportService,
    private readonly reminders: RentalRemindersService,
  ) {}

  @Post('expenses')
  createExpense(@Body() dto: CreateExpenseDto) {
    return this.ops.createExpense(dto);
  }

  @Get('expenses')
  listExpenses(@Query('propertyId') propertyId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.ops.listExpenses({ propertyId, from, to });
  }

  @Delete('expenses/:id')
  deleteExpense(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.deleteExpense(id);
  }

  @Post('maintenance')
  createMaintenance(@Body() dto: CreateMaintenanceDto) {
    return this.ops.createMaintenance(dto);
  }

  @Get('maintenance')
  listMaintenance(@Query('status') status?: string, @Query('propertyId') propertyId?: string) {
    return this.ops.listMaintenance({ status, propertyId });
  }

  @Patch('maintenance/:id')
  updateMaintenance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMaintenanceDto) {
    return this.ops.updateMaintenance(id, dto);
  }

  @Post('meters')
  recordReading(@Body() dto: RecordMeterReadingDto) {
    return this.ops.recordReading(dto);
  }

  @Get('meters')
  listReadings(@Query('unitId') unitId?: string) {
    return this.ops.listReadings({ unitId });
  }

  @Get('reports/monthly')
  monthly(@Query('month') month?: string) {
    return this.reports.monthly(month);
  }

  @Get('reminders/settings')
  reminderSettings() {
    return this.reminders.getSettings();
  }

  @Patch('reminders/settings')
  updateReminderSettings(@Body() dto: UpdateReminderSettingsDto) {
    return this.reminders.updateSettings(dto);
  }

  @Post('tenants/:id/invite')
  @HttpCode(200)
  inviteTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.reminders.sendPortalInvite(id);
  }

  @Post('reminders/send')
  @HttpCode(200)
  sendReminder(@Body() dto: SendReminderDto) {
    return this.reminders.sendManual(dto.leaseId);
  }
}
