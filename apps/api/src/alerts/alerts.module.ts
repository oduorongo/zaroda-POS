import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

/** What is waiting for the business, for the apps' pop-up and ring. Read-only. */
@Module({
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
