import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { AccountingService } from './accounting.service';
import {
  AsOfQueryDto,
  CreateAccountDto,
  CreateJournalDto,
  JournalListQueryDto,
  LedgerSettingsDto,
  PayOffDto,
  RangeQueryDto,
  ReverseJournalDto,
  UpdateAccountDto,
} from './dto/accounting.dto';

const READERS = [Role.MANAGER, Role.OWNER, Role.AUDITOR];
const WRITERS = [Role.MANAGER, Role.OWNER];

/** The books: owners and managers keep them, auditors read them. Closing a period is the owner's (checked in the service). */
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Roles(...READERS)
  @Get('overview')
  overview() {
    return this.accounting.overview();
  }

  @Roles(...WRITERS)
  @Patch('settings')
  updateSettings(@Body() dto: LedgerSettingsDto) {
    return this.accounting.updateSettings(dto);
  }

  @Roles(...WRITERS)
  @Post('post-now')
  postNow() {
    return this.accounting.postNow();
  }

  @Roles(...READERS)
  @Get('owed')
  owed() {
    return this.accounting.owed();
  }

  @Roles(...WRITERS)
  @Post('pay-off')
  payOff(@Body() dto: PayOffDto) {
    return this.accounting.payOff(dto);
  }

  @Roles(...READERS)
  @Get('accounts')
  accounts() {
    return this.accounting.accounts();
  }

  @Roles(...WRITERS)
  @Post('accounts')
  createAccount(@Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(dto);
  }

  @Roles(...WRITERS)
  @Patch('accounts/:id')
  updateAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.accounting.updateAccount(id, dto);
  }

  @Roles(...READERS)
  @Get('accounts/:id/ledger')
  accountLedger(@Param('id', ParseUUIDPipe) id: string, @Query() q: RangeQueryDto) {
    return this.accounting.accountLedger(id, q);
  }

  @Roles(...READERS)
  @Get('journals')
  journals(@Query() q: JournalListQueryDto) {
    return this.accounting.journals(q);
  }

  @Roles(...READERS)
  @Get('journals/:id')
  journal(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounting.journal(id);
  }

  @Roles(...WRITERS)
  @Post('journals')
  createJournal(@Body() dto: CreateJournalDto) {
    return this.accounting.createJournal(dto);
  }

  @Roles(...WRITERS)
  @Post('journals/:id/reverse')
  reverseJournal(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseJournalDto) {
    return this.accounting.reverseJournal(id, dto);
  }

  @Roles(...READERS)
  @Get('reports/trial-balance')
  trialBalance(@Query() q: AsOfQueryDto) {
    return this.accounting.trialBalance(q);
  }

  @Roles(...READERS)
  @Get('reports/profit-loss')
  profitAndLoss(@Query() q: RangeQueryDto) {
    return this.accounting.profitAndLoss(q);
  }

  @Roles(...READERS)
  @Get('reports/balance-sheet')
  balanceSheet(@Query() q: AsOfQueryDto) {
    return this.accounting.balanceSheet(q);
  }
}
