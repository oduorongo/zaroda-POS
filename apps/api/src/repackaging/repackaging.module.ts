import { Module } from '@nestjs/common';
import { RepackagingController } from './repackaging.controller';
import { RepackagingService } from './repackaging.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [RepackagingController],
  providers: [RepackagingService],
})
export class RepackagingModule {}
