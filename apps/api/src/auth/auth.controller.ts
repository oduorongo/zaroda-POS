import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { Public } from './public.decorator';

// Stricter than the app-wide default (100/min - see app.module.ts): these
// are the only two public, pre-JWT endpoints, and pin-login's 4-8 digit
// PIN has as few as 10,000 possible values - 5 attempts/minute per IP
// makes brute-forcing either credential impractical while still leaving
// room for a cashier who fat-fingers their PIN a couple of times.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('pin-login')
  pinLogin(@Body() dto: PinLoginDto) {
    return this.auth.pinLogin(dto);
  }

  // Same throttle as login/pin-login - an unauthenticated endpoint that
  // writes (creates an org + user) is at least as worth rate-limiting as
  // one that only reads.
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterOrganizationDto) {
    return this.auth.register(dto);
  }
}
