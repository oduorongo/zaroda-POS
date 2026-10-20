import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentRiderId, RiderAuthGuard } from './rider-auth';
import { RiderAuthService } from './rider-auth.service';
import { RidersService } from './riders.service';
import { CreateShopRiderDto, RequestRiderCodeDto, RiderPhoneDto, RiderPinLoginDto, RiderPinResetDto, RiderSignupDto, SetRiderPinDto, SetRiderStatusDto, UpdateRiderProfileDto, VerifyRiderCodeDto } from './dto/rider.dto';

// Same tight shape as shopper and staff sign-in - public endpoints that send email or check codes.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/** Rider sign-in. Public. */
@Controller('rider-auth')
export class RiderAuthController {
  constructor(private readonly auth: RiderAuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('request-code')
  @HttpCode(200)
  requestCode(@Body() dto: RequestRiderCodeDto) {
    return this.auth.requestCode(dto.email);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('signup')
  signup(@Body() dto: RiderSignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: RiderPinLoginDto) {
    return this.auth.loginWithPin(dto.phone, dto.pin);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('pin-reset/request')
  @HttpCode(200)
  requestPinReset(@Body() dto: RiderPhoneDto) {
    return this.auth.requestPinReset(dto.phone);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('pin-reset/verify')
  @HttpCode(200)
  resetPin(@Body() dto: RiderPinResetDto) {
    return this.auth.resetPin(dto.phone, dto.code, dto.pin);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyRiderCodeDto) {
    return this.auth.verifyCode(dto.email, dto.code);
  }
}

/** The signed-in rider's own profile - rider token only. */
@Controller('rider')
@Public()
@UseGuards(RiderAuthGuard)
export class RiderController {
  constructor(private readonly riders: RidersService) {}

  @Get('me')
  me(@CurrentRiderId() riderId: string) {
    return this.riders.getMe(riderId);
  }

  @Patch('me/pin')
  setPin(@CurrentRiderId() riderId: string, @Body() dto: SetRiderPinDto) {
    return this.riders.setOwnPin(riderId, dto.pin);
  }

  @Patch('me')
  updateMe(@CurrentRiderId() riderId: string, @Body() dto: UpdateRiderProfileDto) {
    return this.riders.updateMe(riderId, dto);
  }
}

/** A business's own riders - staff JWT (global guard), tenant-scoped. */
@Controller('riders')
@Roles(Role.MANAGER, Role.OWNER)
export class ShopRidersController {
  constructor(private readonly riders: RidersService) {}

  @Get()
  list() {
    return this.riders.listForShop();
  }

  @Post()
  create(@Body() dto: CreateShopRiderDto) {
    return this.riders.createForShop(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRiderProfileDto) {
    return this.riders.updateForShop(id, dto);
  }

  @Post(':id/reset-pin')
  @HttpCode(200)
  resetPin(@Param('id', ParseUUIDPipe) id: string) {
    return this.riders.resetPinForShop(id);
  }

  @Post(':id/status')
  @HttpCode(200)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRiderStatusDto) {
    return this.riders.setStatusForShop(id, dto.status);
  }
}
