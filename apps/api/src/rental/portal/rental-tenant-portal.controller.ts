import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { PortalMaintenanceDto, PortalPayDto, RequestTenantCodeDto, VerifyTenantCodeDto } from './dto/tenant-portal.dto';
import { RentalTenantAuthService } from './rental-tenant-auth.service';
import { RentalTenantPortalService } from './rental-tenant-portal.service';
import { CurrentTenantIdentity, TenantAuthGuard } from './tenant-auth';

// Same tight shape as shopper, rider and staff sign-in - public endpoints that send email or check codes.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
// Each prompt reaches a real phone, so starting one is limited too.
const PAY_THROTTLE = { default: { limit: 4, ttl: 60_000 } };

/** Tenant sign-in. Public. */
@Controller('tenant-auth')
export class RentalTenantAuthController {
  constructor(private readonly auth: RentalTenantAuthService) {}

  /** What the sign-in screen may offer (email always; text message when it is set up on the server). */
  @Public()
  @Get('methods')
  methods() {
    return this.auth.methods();
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('request-code')
  @HttpCode(200)
  requestCode(@Body() dto: RequestTenantCodeDto) {
    return this.auth.requestCode(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyTenantCodeDto) {
    return this.auth.verifyCode(dto);
  }
}

/** What a signed-in tenant can see and do - tenant token only. */
@Controller('tenant-portal')
@Public()
@UseGuards(TenantAuthGuard)
export class RentalTenantPortalController {
  constructor(private readonly portal: RentalTenantPortalService) {}

  @Get('me')
  me(@CurrentTenantIdentity() identity: string) {
    return this.portal.me(identity);
  }

  @Get('leases/:id/statement')
  statement(@CurrentTenantIdentity() identity: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.statement(identity, id);
  }

  @Get('payments/:id')
  receipt(@CurrentTenantIdentity() identity: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.receipt(identity, id);
  }

  @Throttle(PAY_THROTTLE)
  @Post('pay')
  pay(@CurrentTenantIdentity() identity: string, @Body() dto: PortalPayDto) {
    return this.portal.pay(identity, dto);
  }

  @Get('prompts/:id')
  promptStatus(@CurrentTenantIdentity() identity: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.promptStatus(identity, id);
  }

  @Throttle(PAY_THROTTLE)
  @Post('maintenance')
  reportProblem(@CurrentTenantIdentity() identity: string, @Body() dto: PortalMaintenanceDto) {
    return this.portal.reportProblem(identity, dto);
  }
}
