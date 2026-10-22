import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { CancelOrderDto, SchoolLoginDto, StatementQueryDto, SubmitSchoolOrderDto } from '../dto/school-supplier.dto';
import { CurrentSchool, SchoolAuthGuard, SchoolIdentity } from './school-auth';
import { SchoolAuthService } from './school-auth.service';
import { SchoolPortalService } from './school-portal.service';

// Same tight shape as rider, shopper and tenant sign-in.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/** School sign-in. Public. */
@Controller('school-auth')
export class SchoolAuthController {
  constructor(private readonly auth: SchoolAuthService) {}

  /** The business name for the sign-in page; null when the link is wrong or switched off. */
  @Public()
  @Get('portal/:slug')
  portal(@Param('slug') slug: string) {
    return this.auth.portalInfo(slug);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: SchoolLoginDto) {
    return this.auth.login(dto);
  }
}

/** What a signed-in school can see and do - school token only. */
@Controller('school-portal')
@Public()
@UseGuards(SchoolAuthGuard)
export class SchoolPortalController {
  constructor(private readonly portal: SchoolPortalService) {}

  @Get('me')
  me(@CurrentSchool() who: SchoolIdentity) {
    return this.portal.me(who);
  }

  @Get('price-list')
  priceList(@CurrentSchool() who: SchoolIdentity) {
    return this.portal.priceList(who);
  }

  @Post('orders')
  submit(@CurrentSchool() who: SchoolIdentity, @Body() dto: SubmitSchoolOrderDto) {
    return this.portal.submitOrder(who, dto);
  }

  @Get('orders')
  orders(@CurrentSchool() who: SchoolIdentity) {
    return this.portal.listOrders(who);
  }

  @Get('orders/:id')
  order(@CurrentSchool() who: SchoolIdentity, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.getOrder(who, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentSchool() who: SchoolIdentity, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto) {
    return this.portal.cancelOrder(who, id, dto.reason);
  }

  @Get('invoices')
  invoices(@CurrentSchool() who: SchoolIdentity) {
    return this.portal.listInvoices(who);
  }

  @Get('invoices/:id')
  invoice(@CurrentSchool() who: SchoolIdentity, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.getInvoice(who, id);
  }

  @Get('receipts')
  receipts(@CurrentSchool() who: SchoolIdentity) {
    return this.portal.listReceipts(who);
  }

  @Get('receipts/:id')
  receipt(@CurrentSchool() who: SchoolIdentity, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.getReceipt(who, id);
  }

  @Get('statement')
  statement(@CurrentSchool() who: SchoolIdentity, @Query() q: StatementQueryDto) {
    return this.portal.statement(who, q.from, q.to);
  }
}
