import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  ConnectDeviceDto,
  ItemClassQueryDto,
  UpdateEtimsSettingsDto,
} from './dto/etims.dto';
import {
  ClassifyItemsDto,
  ItemListQueryDto,
  RegisterItemsDto,
  UpdateEtimsItemDto,
} from './dto/etims-items.dto';
import { DocumentListQueryDto } from './dto/etims-documents.dto';
import { EtimsCodesService } from './etims-codes.service';
import { EtimsDocumentsService } from './etims-documents.service';
import { EtimsItemsService } from './etims-items.service';
import { EtimsExtrasService } from './etims-extras.service';
import { ImportDecisionDto } from './dto/etims-extras.dto';
import { EtimsReceiptsService } from './etims-receipts.service';
import { EtimsReportsService } from './etims-reports.service';
import { EtimsSettingsService } from './etims-settings.service';

// eTIMS is the business's tax setup, so it is for owners and managers; an auditor can look.
const WRITERS = [Role.MANAGER, Role.OWNER];
const READERS = [Role.MANAGER, Role.OWNER, Role.AUDITOR];
// the till staff may print a sale's receipt and look at the X report
const TILL_AND_READERS = [Role.CASHIER, Role.SUPERVISOR, ...READERS];

@Controller('etims')
export class EtimsController {
  constructor(
    private readonly settings: EtimsSettingsService,
    private readonly codes: EtimsCodesService,
    private readonly items: EtimsItemsService,
    private readonly documents: EtimsDocumentsService,
    private readonly receipts: EtimsReceiptsService,
    private readonly reports: EtimsReportsService,
    private readonly extras: EtimsExtrasService,
  ) {}

  @Roles(...READERS)
  @Get('settings')
  overview() {
    return this.settings.overview();
  }

  @Roles(...WRITERS)
  @Put('settings')
  update(@Body() dto: UpdateEtimsSettingsDto) {
    return this.settings.update(dto);
  }

  @Roles(...WRITERS)
  @Post('devices/:branchId/connect')
  @HttpCode(200)
  connect(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: ConnectDeviceDto,
  ) {
    return this.settings.connect(branchId, dto);
  }

  @Roles(...WRITERS)
  @Post('devices/:branchId/disconnect')
  @HttpCode(200)
  disconnect(@Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.settings.disconnect(branchId);
  }

  @Roles(...WRITERS)
  @Post('codes/sync')
  @HttpCode(200)
  sync() {
    return this.codes.sync();
  }

  @Roles(...READERS)
  @Get('codes/summary')
  summary() {
    return this.codes.counts();
  }

  @Roles(...READERS)
  @Get('codes')
  lists(@Query('cls') cls?: string) {
    return this.codes.lists(cls);
  }

  @Roles(...READERS)
  @Get('item-classes')
  itemClasses(@Query() q: ItemClassQueryDto) {
    return this.codes.searchItemClasses(q.search, q.limit);
  }

  // ── Products as KRA knows them ──
  @Roles(...READERS)
  @Get('items')
  listItems(@Query() q: ItemListQueryDto) {
    return this.items.list(q);
  }

  @Roles(...WRITERS)
  @Put('items/:variantId')
  updateItem(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateEtimsItemDto,
  ) {
    return this.items.update(variantId, dto);
  }

  @Roles(...WRITERS)
  @Post('items/classify')
  @HttpCode(200)
  classify(@Body() dto: ClassifyItemsDto) {
    return this.items.classify(dto.variantIds, dto.itemClsCd);
  }

  @Roles(...WRITERS)
  @Post('items/register')
  @HttpCode(200)
  register(@Body() dto: RegisterItemsDto) {
    return this.items.register(dto);
  }

  // ── Sales, refunds and stock sent to KRA ──
  @Roles(...READERS)
  @Get('documents')
  listDocuments(@Query() q: DocumentListQueryDto) {
    return this.documents.list(q);
  }

  @Roles(...READERS)
  @Get('documents/by-sale/:saleId')
  documentsForSale(@Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.documents.forSale(saleId);
  }

  // ── KRA receipts and the X / Z / PLU reports (TIS specification) ──
  /** The KRA receipt of a sale (and of its credit note), once KRA has signed it. ?copy=true prints it as a COPY, which is counted. */
  @Roles(...TILL_AND_READERS)
  @Get('receipts/by-sale/:saleId')
  receiptForSale(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Query('copy') copy?: string,
  ) {
    return this.receipts.forSale(saleId, copy === 'true');
  }

  @Roles(...TILL_AND_READERS)
  @Get('reports/x')
  xReport(@Query('branchId', ParseUUIDPipe) branchId: string) {
    return this.reports.x(branchId);
  }

  /** Closes the period and keeps the report. Owners and managers only. */
  @Roles(...WRITERS)
  @Post('reports/z')
  zReport(@Query('branchId', ParseUUIDPipe) branchId: string) {
    return this.reports.z(branchId);
  }

  @Roles(...READERS)
  @Get('reports/z')
  zReports(@Query('branchId', ParseUUIDPipe) branchId: string) {
    return this.reports.listZ(branchId);
  }

  @Roles(...READERS)
  @Get('reports/z/:id')
  zReportById(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getZ(id);
  }

  @Roles(...READERS)
  @Get('reports/plu')
  pluReport(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reports.plu(branchId, from, to);
  }

  @Roles(...READERS)
  @Get('reports/closing-stock')
  closingStock(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @Query('date') date: string,
  ) {
    return this.reports.closingStock(branchId, date);
  }

  // ── PIN lookup, KRA branches, notices, imported items, customers (OSCU spec 3.3.2 - 3.3.5) ──
  /** What KRA knows about a PIN. The till may check a customer's PIN too. */
  @Roles(...TILL_AND_READERS)
  @Get('pin/:pin')
  lookupPin(@Param('pin') pin: string) {
    return this.extras.lookupPin(pin);
  }

  @Roles(...READERS)
  @Get('kra-branches')
  kraBranches() {
    return this.extras.branches();
  }

  @Roles(...READERS)
  @Get('notices')
  notices() {
    return this.extras.notices();
  }

  @Roles(...WRITERS)
  @Post('notices/sync')
  @HttpCode(200)
  syncNotices() {
    return this.extras.syncNotices();
  }

  @Roles(...READERS)
  @Post('notices/:id/read')
  @HttpCode(200)
  readNotice(@Param('id', ParseUUIDPipe) id: string) {
    return this.extras.markNoticeRead(id);
  }

  @Roles(...READERS)
  @Get('imports')
  imports() {
    return this.extras.imports();
  }

  @Roles(...WRITERS)
  @Post('imports/sync')
  @HttpCode(200)
  syncImports() {
    return this.extras.syncImports();
  }

  @Roles(...WRITERS)
  @Post('imports/:id/decision')
  @HttpCode(200)
  decideImport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportDecisionDto,
  ) {
    return this.extras.decideImport(id, dto.decision, dto.variantId, dto.remark);
  }

  /** Sends customers with a KRA PIN now, instead of waiting for the timed pass. */
  @Roles(...WRITERS)
  @Post('customers/sync')
  @HttpCode(200)
  syncCustomers() {
    return this.extras.syncCustomers();
  }

  /** Send what is waiting now instead of at the next timed pass. */
  @Roles(...WRITERS)
  @Post('documents/run')
  @HttpCode(200)
  runDocuments() {
    return this.documents.runPass();
  }

  @Roles(...WRITERS)
  @Post('documents/:id/retry')
  @HttpCode(200)
  retryDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.retry(id);
  }
}
