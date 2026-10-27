import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { LedgerBooksService } from './ledger-books.service';
import { LedgerPosterService } from './ledger-poster.service';
import { LedgerSchedulerService } from './ledger-scheduler.service';

/** The general ledger (double-entry books) for every kind of business. Core: no industry manifest. */
@Module({
  controllers: [AccountingController],
  providers: [AccountingService, LedgerBooksService, LedgerPosterService, LedgerSchedulerService],
})
export class AccountingModule {}
