import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommissionCallbackController } from './commission.controller';
import { CommissionSchedulerService } from './commission-scheduler.service';
import { CommissionService } from './commission.service';
import { OnlineStoreController } from './online-store.controller';
import { OnlineStoreService } from './online-store.service';
import { DarajaClient } from './daraja.client';
import { TumaClient } from './tuma.client';

@Module({
  imports: [NotificationsModule],
  controllers: [OnlineStoreController, CommissionCallbackController],
  providers: [OnlineStoreService, TumaClient, DarajaClient, CommissionService, CommissionSchedulerService],
  exports: [TumaClient, DarajaClient, CommissionService],
})
export class OnlineStoreModule {}
