import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  BouncePaymentDto,
  CertificateDto,
  AcceptQuoteDto,
  CancelOrderDto,
  CloseBalanceDto,
  DeclineQuoteDto,
  FollowUpDto,
  LpoCheckDto,
  SaveQuoteDto,
  CreateCreditNoteDto,
  ConfirmOrderDto,
  CreateSchoolDto,
  DeliverOrderDto,
  ListQueryDto,
  RecordPaymentDto,
  SavePortalDto,
  SavePriceListDto,
  StatementQueryDto,
  UpdateSchoolDto,
  VoidInvoiceDto,
} from './dto/school-supplier.dto';
import { PriceListService } from './price-list.service';
import { SchoolBillingService } from './school-billing.service';
import { SchoolCollectionsService } from './school-collections.service';
import { SchoolWithholdingService } from './school-withholding.service';
import { SchoolCreditNotesService } from './school-credit-notes.service';
import { SchoolOrdersService } from './school-orders.service';
import { SchoolQuotesService } from './school-quotes.service';
import { SchoolsService } from './schools.service';

/** The supplier's side: owners and managers do the work, auditors can look. */
@Controller('school-supplier')
export class SchoolSupplierController {
  constructor(
    private readonly schools: SchoolsService,
    private readonly priceList: PriceListService,
    private readonly orders: SchoolOrdersService,
    private readonly billing: SchoolBillingService,
    private readonly credits: SchoolCreditNotesService,
    private readonly quotes: SchoolQuotesService,
    private readonly collections: SchoolCollectionsService,
    private readonly withholding: SchoolWithholdingService,
  ) {}

  // ── Schools ──
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('schools')
  listSchools() {
    return this.schools.list();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('schools')
  createSchool(@Body() dto: CreateSchoolDto) {
    return this.schools.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('schools/:id')
  getSchool(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.get(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('schools/:id')
  updateSchool(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSchoolDto,
  ) {
    return this.schools.update(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('schools/:id/reset-pin')
  @HttpCode(200)
  resetPin(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.resetPin(id);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('schools/:id/statement')
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StatementQueryDto,
  ) {
    return this.schools
      .statement(id, q.from, q.to)
      .then(async (s) => ({ ...s, business: await this.billing.letterhead() }));
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('receivables')
  receivables() {
    return this.schools.receivables();
  }

  // ── Price list and the portal's address ──
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('price-list')
  getPriceList() {
    return this.priceList.list();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Put('price-list')
  savePriceList(@Body() dto: SavePriceListDto) {
    return this.priceList.save(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('portal')
  getPortal() {
    return this.priceList.getPortal();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Put('portal')
  savePortal(@Body() dto: SavePortalDto) {
    return this.priceList.savePortal(dto);
  }

  // ── Orders ──
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('orders')
  listOrders(@Query() q: ListQueryDto) {
    return this.orders.list(q.status, q.schoolId);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('orders/pending-count')
  async pendingCount() {
    return { count: await this.orders.pendingCount() };
  }

  /** What is in stock at a branch for each line of an order. */
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('orders/:id/stock')
  orderStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.orders.stockFor(id, branchId);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('orders/:id')
  async getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return {
      ...(await this.orders.get(id)),
      business: await this.billing.letterhead(),
    };
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('orders/:id/confirm')
  @HttpCode(200)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmOrderDto,
  ) {
    return this.orders.confirm(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('orders/:id/deliver')
  @HttpCode(200)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliverOrderDto,
  ) {
    return this.orders.deliver(id, dto);
  }

  /** Ticks that the school's LPO was received and checked against its signed copy. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Post('orders/:id/lpo-check')
  @HttpCode(200)
  lpoCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LpoCheckDto,
  ) {
    return this.orders.checkLpo(id, dto.checked);
  }

  /** Stop waiting to deliver the rest of a partly delivered order. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Post('orders/:id/close-balance')
  @HttpCode(200)
  closeBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseBalanceDto,
  ) {
    return this.orders.closeBalance(id, dto);
  }

  /** One delivery's note, ready to print. */
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('deliveries/:id')
  async getDelivery(@Param('id', ParseUUIDPipe) id: string) {
    return {
      ...(await this.orders.deliveryNote(id)),
      business: await this.billing.letterhead(),
    };
  }

  // ── Tax the schools withheld ──
  /** What was withheld, by school, and which certificates are still missing. */
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('withholding')
  withholdingSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.withholding.summary(from, to);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('payments/:id/certificate')
  setCertificate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CertificateDto,
  ) {
    return this.withholding.setCertificate(id, dto);
  }

  // ── Chasing what is owed ──
  /** Overdue invoices in the order to chase them, with each one's follow-up. */
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('overdue')
  overdue() {
    return this.collections.overdue();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('invoices/:id/follow-up')
  followUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FollowUpDto,
  ) {
    return this.collections.saveFollowUp(id, dto);
  }

  /** What a school still owes, invoice by invoice, to choose which a payment pays. */
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('schools/:id/open-invoices')
  openInvoices(@Param('id', ParseUUIDPipe) id: string) {
    return this.collections.openInvoicesOf(id);
  }

  // ── Quotations ──
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('quotes')
  listQuotes(@Query() q: ListQueryDto) {
    return this.quotes.list(q.status, q.schoolId);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('quotes/:id')
  async getQuote(@Param('id', ParseUUIDPipe) id: string) {
    return {
      ...(await this.quotes.get(id)),
      business: await this.billing.letterhead(),
    };
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('quotes')
  createQuote(@Body() dto: SaveQuoteDto) {
    return this.quotes.create(dto);
  }

  /** Replaces a draft quotation. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Put('quotes/:id')
  updateQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveQuoteDto,
  ) {
    return this.quotes.update(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete('quotes/:id')
  deleteQuote(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.remove(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('quotes/:id/issue')
  @HttpCode(200)
  issueQuote(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.issue(id);
  }

  /** Records that the school accepted (by phone, by LPO...): makes the order. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Post('quotes/:id/accept')
  @HttpCode(200)
  acceptQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptQuoteDto,
  ) {
    return this.quotes.accept(id, 'SUPPLIER', dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('quotes/:id/decline')
  @HttpCode(200)
  declineQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineQuoteDto,
  ) {
    return this.quotes.decline(id, 'SUPPLIER', dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('quotes/:id/revise')
  @HttpCode(200)
  reviseQuote(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.revise(id);
  }

  // ── Credit notes ──
  /** What can still be credited on an invoice, line by line. */
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('invoices/:id/creditable')
  creditable(@Param('id', ParseUUIDPipe) id: string) {
    return this.credits.creditable(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('credit-notes')
  createCreditNote(@Body() dto: CreateCreditNoteDto) {
    return this.credits.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('credit-notes')
  listCreditNotes(@Query() q: ListQueryDto) {
    return this.credits.list(q.schoolId);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('credit-notes/:id')
  async getCreditNote(@Param('id', ParseUUIDPipe) id: string) {
    return {
      ...(await this.credits.get(id)),
      business: await this.billing.letterhead(),
    };
  }

  // ── Invoices ──
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('invoices')
  listInvoices(@Query() q: ListQueryDto) {
    return this.billing.listInvoices(q.status, q.schoolId);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('invoices/:id')
  getInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.getInvoice(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('invoices/:id/void')
  @HttpCode(200)
  voidInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
  ) {
    return this.billing.voidInvoice(id, dto);
  }

  // ── Payments and receipts ──
  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('payments')
  listPayments(@Query() q: ListQueryDto) {
    return this.billing.listPayments(q.schoolId);
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('payments/:id')
  getPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.getPayment(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('payments')
  recordPayment(@Body() dto: RecordPaymentDto) {
    return this.billing.recordPayment(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('payments/:id/bounce')
  @HttpCode(200)
  bounce(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BouncePaymentDto,
  ) {
    return this.billing.bouncePayment(id, dto);
  }
}
