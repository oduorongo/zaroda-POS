import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { AlertsService } from './alerts.service';

/** The staff apps (back office and till) ask this every few seconds to pop up and ring for new orders and table requests. */
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Roles(Role.CASHIER, Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Get('staff')
  staff() {
    return this.alerts.staff();
  }
}
