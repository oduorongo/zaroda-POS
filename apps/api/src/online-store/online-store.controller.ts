import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PAY_THROTTLE, PayInvoiceDto } from './commission.controller';
import { CommissionService } from './commission.service';
import { OnlineStoreService } from './online-store.service';
import { ConnectMpesaDto, ConnectTumaDto, SetGatewayDto, UpdateOnlineStoreDto } from './dto/update-online-store.dto';

// Each attempt makes an outbound call to TUMA - throttled so this endpoint
// can't be used to hammer TUMA or brute-force API keys through Zaroda.
const TUMA_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

// Owner/manager only throughout - this is where payment credentials and
// the public face of the business are configured. JwtAuthGuard is global.
@Controller('online-store/me')
@Roles(Role.MANAGER, Role.OWNER)
export class OnlineStoreController {
  constructor(
    private readonly onlineStore: OnlineStoreService,
    private readonly commission: CommissionService,
  ) {}

  @Get()
  getMine() {
    return this.onlineStore.getMine();
  }

  // What the business owes Zaroda: unbilled completed orders, monthly
  // invoices, and whether the shop is currently paused for non-payment.
  @Get('commission')
  getCommission() {
    return this.commission.getMine();
  }

  // Pay an invoice with M-Pesa through ZARODA's own Tuma account.
  @Throttle(PAY_THROTTLE)
  @Post('commission/invoices/:id/pay')
  @HttpCode(200)
  payInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayInvoiceDto) {
    return this.commission.payOnline(id, dto.phone);
  }

  // The page polls this while it waits for the PIN.
  @Post('commission/invoices/:id/check')
  @HttpCode(200)
  checkInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.commission.checkPayment(id);
  }

  @Patch()
  updateMine(@Body() dto: UpdateOnlineStoreDto) {
    return this.onlineStore.updateMine(dto);
  }

  @Throttle(TUMA_THROTTLE)
  @Post('tuma')
  connectTuma(@Body() dto: ConnectTumaDto) {
    return this.onlineStore.connectTuma(dto);
  }

  @Delete('tuma')
  disconnectTuma() {
    return this.onlineStore.disconnectTuma();
  }

  // The business's OWN M-Pesa (Safaricom Daraja): throttled like Tuma, since each attempt calls Safaricom.
  @Throttle(TUMA_THROTTLE)
  @Post('mpesa')
  connectMpesa(@Body() dto: ConnectMpesaDto) {
    return this.onlineStore.connectMpesa(dto);
  }

  @Delete('mpesa')
  disconnectMpesa() {
    return this.onlineStore.disconnectMpesa();
  }

  @Post('payment-gateway')
  setGateway(@Body() dto: SetGatewayDto) {
    return this.onlineStore.setGateway(dto.gateway);
  }
}
