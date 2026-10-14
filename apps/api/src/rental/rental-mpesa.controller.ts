import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { ConnectMpesaDto, ConnectTumaDto, SetGatewayDto } from '../online-store/dto/update-online-store.dto';
import { RequestPaymentDto } from './dto/rental-mpesa.dto';
import { RentalMpesaService } from './rental-mpesa.service';

// A Tuma status check costs the landlord KES 1, so "check now" is throttled here as well as in the service.
const CHECK_THROTTLE = { default: { limit: 4, ttl: 60_000 } };

/** The landlord's M-Pesa collection settings and the prompts they send to tenants. Managers and owners only. */
@Controller('rental/mpesa')
@Roles(Role.MANAGER, Role.OWNER)
export class RentalMpesaController {
  constructor(private readonly mpesa: RentalMpesaService) {}

  @Get('settings')
  settings() {
    return this.mpesa.getSettings();
  }

  @Post('tuma')
  connectTuma(@Body() dto: ConnectTumaDto) {
    return this.mpesa.connectTuma(dto);
  }

  @Delete('tuma')
  disconnectTuma() {
    return this.mpesa.disconnectTuma();
  }

  @Post('daraja')
  connectMpesa(@Body() dto: ConnectMpesaDto) {
    return this.mpesa.connectMpesa(dto);
  }

  @Delete('daraja')
  disconnectMpesa() {
    return this.mpesa.disconnectMpesa();
  }

  @Post('gateway')
  setGateway(@Body() dto: SetGatewayDto) {
    return this.mpesa.setGateway(dto.gateway);
  }

  @Post('requests')
  request(@Body() dto: RequestPaymentDto) {
    return this.mpesa.requestPayment(dto);
  }

  @Get('requests')
  requests() {
    return this.mpesa.listRequests();
  }

  @Throttle(CHECK_THROTTLE)
  @Post('requests/:id/check')
  @HttpCode(200)
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.mpesa.checkRequest(id);
  }
}

/** Where Tuma and Safaricom report back. Public, but every address carries a secret token for that one request. */
@Controller('public/rental-payments')
export class RentalCallbackController {
  constructor(private readonly mpesa: RentalMpesaService) {}

  @Public()
  @Post(':organizationId/:requestId/tuma-callback/:token')
  @HttpCode(200)
  tuma(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.mpesa.handleTumaCallback(organizationId, requestId, token, body);
  }

  @Public()
  @Post(':organizationId/:requestId/daraja-callback/:token')
  @HttpCode(200)
  daraja(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.mpesa.handleDarajaCallback(organizationId, requestId, token, body);
  }
}
