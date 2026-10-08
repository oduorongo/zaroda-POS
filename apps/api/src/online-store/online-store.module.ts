import { Module } from '@nestjs/common';
import { OnlineStoreController } from './online-store.controller';
import { OnlineStoreService } from './online-store.service';
import { TumaClient } from './tuma.client';

@Module({
  controllers: [OnlineStoreController],
  providers: [OnlineStoreService, TumaClient],
  exports: [TumaClient],
})
export class OnlineStoreModule {}
