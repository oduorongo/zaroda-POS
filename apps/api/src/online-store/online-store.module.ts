import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommissionService } from './commission.service';
import { OnlineStoreController } from './online-store.controller';
import { OnlineStoreService } from './online-store.service';
import { TumaClient } from './tuma.client';

@Module({
  imports: [NotificationsModule],
  controllers: [OnlineStoreController],
  providers: [OnlineStoreService, TumaClient, CommissionService],
  exports: [TumaClient, CommissionService],
})
export class OnlineStoreModule {}
