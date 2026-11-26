import { AppIncomeSyncController } from './app-income.controller';
import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { LedgerBooksService } from './ledger-books.service';
import { LedgerPosterService } from './ledger-poster.service';
import { LedgerSchedulerService } from './ledger-scheduler.service';
import { PlatformLedgerService } from './platform-ledger.service';
import { FarmValuationService } from '../farm/farm-valuation.service';

/** The general ledger (double-entry books) for every kind of business, and ZARODA's own. Core: no industry manifest. */
@Module({
  controllers: [AccountingController, AppIncomeSyncController],
  // FarmValuationService: a farm's livestock is carried in its books at its value (it needs only the shared prisma and audit log)
  providers: [AccountingService, LedgerBooksService, LedgerPosterService, LedgerSchedulerService, PlatformLedgerService, FarmValuationService],
  // ZARODA's own books are kept from the platform admin
  exports: [PlatformLedgerService],
})
export class AccountingModule {}
