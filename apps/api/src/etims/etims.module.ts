import { Module } from '@nestjs/common';
import { EtimsClient } from './etims.client';
import { EtimsCodesService } from './etims-codes.service';
import { EtimsController } from './etims.controller';
import { EtimsDocumentsService } from './etims-documents.service';
import { EtimsSchedulerService } from './etims-scheduler.service';
import { EtimsItemsService } from './etims-items.service';
import { EtimsPurchasesService } from './etims-purchases.service';
import { EtimsSettingsService } from './etims-settings.service';

/**
 * KRA eTIMS (OSCU) integration. Phase 1 is the foundation: a business's switch and PIN, one connected device per branch, and KRA's
 * code lists. Selling, items, stock and purchases come in the next phases and plug in through events, so the rest of the system
 * never needs to know what KRA's messages look like.
 */
@Module({
  controllers: [EtimsController],
  providers: [
    EtimsClient,
    EtimsSettingsService,
    EtimsCodesService,
    EtimsItemsService,
    EtimsDocumentsService,
    EtimsPurchasesService,
    EtimsSchedulerService,
  ],
  exports: [EtimsSettingsService, EtimsClient],
})
export class EtimsModule {}
