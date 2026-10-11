import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { BuyerAuthGuard, CurrentBuyerId } from './buyer-auth';
import { BuyerAuthService } from './buyer-auth.service';
import { OnlineOrdersService } from './online-orders.service';
import { ShopCatalogService } from './shop-catalog.service';
import {
  CancelOnlineOrderDto,
  ConfirmOrderPaymentDto,
  CreateOnlineOrderDto,
  ListOnlineOrdersQueryDto,
  RequestBuyerCodeDto,
  RetryPaymentDto,
  UpdateBuyerDto,
  VerifyBuyerCodeDto,
} from './dto/online-order.dto';

// Same tight shape as staff login (auth.controller.ts) - these are public
// endpoints that send SMS or check codes.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const CHECKOUT_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const CHECK_THROTTLE = { default: { limit: 4, ttl: 60_000 } };

/** Public, unauthenticated: a live shop's catalog. */
@Controller('public/shops')
export class PublicShopsController {
  constructor(private readonly catalog: ShopCatalogService) {}

  @Public()
  @Get()
  listShops(@Query('q') q?: string) {
    return this.catalog.listShops(q?.slice(0, 80));
  }

  @Public()
  @Get(':slug')
  getShop(@Param('slug') slug: string) {
    return this.catalog.getShop(slug);
  }
}

/** TUMA's payment webhook. Authenticated by the HMAC token in the URL - see OnlineOrdersService.handleTumaCallback. */
@Controller('public/online-orders')
export class TumaCallbackController {
  constructor(private readonly orders: OnlineOrdersService) {}

  @Public()
  @Post(':organizationId/:orderId/tuma-callback/:token')
  @HttpCode(200)
  callback(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.orders.handleTumaCallback(organizationId, orderId, token, body);
  }
}

/** Buyer phone login. */
@Controller('buyer-auth')
export class BuyerAuthController {
  constructor(private readonly auth: BuyerAuthService) {}

  // What the sign-in screen may offer (email always; SMS only when it is set up).
  @Public()
  @Get('methods')
  methods() {
    return this.auth.methods();
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('request-code')
  @HttpCode(200)
  requestCode(@Body() dto: RequestBuyerCodeDto) {
    return this.auth.requestCode({ email: dto.email, phone: dto.phone });
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyBuyerCodeDto) {
    return this.auth.verifyCode({ email: dto.email, phone: dto.phone, code: dto.code });
  }
}

// Every buyer route: @Public() skips the staff JwtAuthGuard, BuyerAuthGuard
// requires a buyer token instead (same pattern as the platform-admin routes).
@Controller('buyer')
@Public()
@UseGuards(BuyerAuthGuard)
export class BuyerController {
  constructor(
    private readonly auth: BuyerAuthService,
    private readonly orders: OnlineOrdersService,
  ) {}

  @Get('me')
  getMe(@CurrentBuyerId() buyerId: string) {
    return this.auth.getMe(buyerId);
  }

  @Patch('me')
  updateMe(@CurrentBuyerId() buyerId: string, @Body() dto: UpdateBuyerDto) {
    return this.auth.updateMe(buyerId, dto.name);
  }

  @Throttle(CHECKOUT_THROTTLE)
  @Post('orders')
  createOrder(@CurrentBuyerId() buyerId: string, @Body() dto: CreateOnlineOrderDto) {
    return this.orders.createOrder(buyerId, dto);
  }

  @Get('orders')
  listOrders(@CurrentBuyerId() buyerId: string) {
    return this.orders.listForBuyer(buyerId);
  }

  @Get('orders/:id')
  getOrder(@CurrentBuyerId() buyerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForBuyer(buyerId, id);
  }

  @Throttle(CHECKOUT_THROTTLE)
  @Post('orders/:id/pay')
  @HttpCode(200)
  retryPayment(@CurrentBuyerId() buyerId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryPaymentDto) {
    return this.orders.retryPayment(buyerId, id, dto.paymentPhone);
  }

  // "I've paid, check now": the backup when no callback arrived. Each call
  // costs the shop KES 1 (Tuma's status check), so it is throttled here and
  // limited per order in the service.
  @Throttle(CHECK_THROTTLE)
  @Post('orders/:id/check')
  @HttpCode(200)
  checkPayment(@CurrentBuyerId() buyerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.checkPaymentForBuyer(buyerId, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentBuyerId() buyerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancelByBuyer(buyerId, id);
  }
}

/** The business's side - staff JWT (global guard), tenant-scoped. */
@Controller('online-orders')
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
export class OnlineOrdersController {
  constructor(private readonly orders: OnlineOrdersService) {}

  @Get()
  list(@Query() query: ListOnlineOrdersQueryDto) {
    return this.orders.listForBusiness(query.status);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForBusiness(id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.accept(id);
  }

  @Post(':id/ready')
  @HttpCode(200)
  ready(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.markReady(id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.complete(id);
  }

  // For when the shop can see the M-Pesa message but the automatic confirmation
  // didn't come. Managers only: it releases an order for fulfilment.
  @Roles(Role.MANAGER, Role.OWNER)
  @Post(':id/confirm-payment')
  @HttpCode(200)
  confirmPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmOrderPaymentDto) {
    return this.orders.confirmPaymentByBusiness(id, dto.receipt);
  }

  // Cancelling a paid order means the business owes a refund - managers only.
  @Roles(Role.MANAGER, Role.OWNER)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOnlineOrderDto) {
    return this.orders.cancelByBusiness(id, dto);
  }
}
