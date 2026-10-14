import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { PortalMaintenanceDto, PortalPayDto, RequestTenantCodeDto, VerifyTenantCodeDto } from './dto/tenant-portal.dto';
import { RentalTenantAuthService } from './rental-tenant-auth.service';
import { RentalTenantPortalService } from './rental-tenant-portal.service';
import { CurrentTenantEmail, TenantAuthGuard } from './tenant-auth';

// Same tight shape as shopper, rider and staff sign-in - public endpoints that send email or check codes.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
// Each prompt reaches a real phone, so starting one is limited too.
const PAY_THROTTLE = { default: { limit: 4, ttl: 60_000 } };

/** Tenant sign-in. Public. */
@Controller('tenant-auth')
export class RentalTenantAuthController {
  constructor(private readonly auth: RentalTenantAuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('request-code')
  @HttpCode(200)
  requestCode(@Body() dto: RequestTenantCodeDto) {
    return this.auth.requestCode(dto.email);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyTenantCodeDto) {
    return this.auth.verifyCode(dto.email, dto.code);
  }
}

/** What a signed-in tenant can see and do - tenant token only. */
@Controller('tenant-portal')
@Public()
@UseGuards(TenantAuthGuard)
export class RentalTenantPortalController {
  constructor(private readonly portal: RentalTenantPortalService) {}

  @Get('me')
  me(@CurrentTenantEmail() email: string) {
    return this.portal.me(email);
  }

  @Get('leases/:id/statement')
  statement(@CurrentTenantEmail() email: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.statement(email, id);
  }

  @Get('payments/:id')
  receipt(@CurrentTenantEmail() email: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.receipt(email, id);
  }

  @Throttle(PAY_THROTTLE)
  @Post('pay')
  pay(@CurrentTenantEmail() email: string, @Body() dto: PortalPayDto) {
    return this.portal.pay(email, dto);
  }

  @Get('prompts/:id')
  promptStatus(@CurrentTenantEmail() email: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.promptStatus(email, id);
  }

  @Throttle(PAY_THROTTLE)
  @Post('maintenance')
  reportProblem(@CurrentTenantEmail() email: string, @Body() dto: PortalMaintenanceDto) {
    return this.portal.reportProblem(email, dto);
  }
}
