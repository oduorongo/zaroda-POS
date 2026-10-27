import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { AsOfQueryDto, CreateAccountDto, CreateJournalDto, JournalListQueryDto, LedgerSettingsDto, RangeQueryDto, ReverseJournalDto, UpdateAccountDto } from '../accounting/dto/accounting.dto';
import { PlatformLedgerService } from '../accounting/platform-ledger.service';
import { PlatformAdminAuthGuard } from './platform-admin-auth.guard';
import { PlatformAuditLogService } from './platform-audit-log.service';

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

/** ZARODA's own books, for platform admins. Same guard pattern as PlatformAdminController; every change is in the platform audit log. */
@Public()
@UseGuards(PlatformAdminAuthGuard)
@Controller('platform-admin/accounting')
export class PlatformAccountingController {
  constructor(
    private readonly ledger: PlatformLedgerService,
    private readonly auditLog: PlatformAuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  private async admin(req: PlatformAdminRequest) {
    const id = req.user!.platformAdminId;
    const a = await this.prisma.platformAdmin.findUnique({ where: { id }, select: { fullName: true } });
    return { id, name: a?.fullName ?? null };
  }

  private log(req: PlatformAdminRequest, action: string, entityId?: string) {
    return this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: `platform_admin.accounting.${action}`, entityType: 'PlatformLedger', entityId });
  }

  @Get('overview')
  overview() {
    return this.ledger.overview();
  }

  @Patch('settings')
  async updateSettings(@Req() req: PlatformAdminRequest, @Body() dto: LedgerSettingsDto) {
    const r = await this.ledger.updateSettings({ startDate: dto.startDate, lockDate: dto.lockDate });
    await this.log(req, 'settings_changed');
    return r;
  }

  @Post('post-now')
  postNow() {
    return this.ledger.runPass();
  }

  @Get('accounts')
  accounts() {
    return this.ledger.accounts();
  }

  @Post('accounts')
  async createAccount(@Req() req: PlatformAdminRequest, @Body() dto: CreateAccountDto) {
    const a = await this.ledger.createAccount(dto);
    await this.log(req, 'account_created', a.id);
    return a;
  }

  @Patch('accounts/:id')
  async updateAccount(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    const a = await this.ledger.updateAccount(id, dto);
    await this.log(req, 'account_updated', id);
    return a;
  }

  @Get('accounts/:id/ledger')
  accountLedger(@Param('id', ParseUUIDPipe) id: string, @Query() q: RangeQueryDto) {
    return this.ledger.accountLedger(id, q);
  }

  @Get('journals')
  journals(@Query() q: JournalListQueryDto) {
    return this.ledger.journals(q);
  }

  @Get('journals/:id')
  journal(@Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.journal(id);
  }

  @Post('journals')
  async createJournal(@Req() req: PlatformAdminRequest, @Body() dto: CreateJournalDto) {
    const j = await this.ledger.createJournal(dto, await this.admin(req));
    await this.log(req, 'journal_created', j.id);
    return j;
  }

  @Post('journals/:id/reverse')
  async reverseJournal(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseJournalDto) {
    const j = await this.ledger.reverseJournal(id, dto, await this.admin(req));
    await this.log(req, 'journal_reversed', id);
    return j;
  }

  @Get('reports/trial-balance')
  trialBalance(@Query() q: AsOfQueryDto) {
    return this.ledger.trialBalance(q.asOf);
  }

  @Get('reports/profit-loss')
  profitAndLoss(@Query() q: RangeQueryDto) {
    return this.ledger.profitAndLoss(q);
  }

  @Get('reports/balance-sheet')
  balanceSheet(@Query() q: AsOfQueryDto) {
    return this.ledger.balanceSheet(q.asOf);
  }
}
