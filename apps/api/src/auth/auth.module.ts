import { Module } from '@nestjs/common';
import { SeasonalBillingModule } from '../seasonal-billing/seasonal-billing.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PinLockoutService } from './pin-lockout.service';

@Module({
  imports: [
    PassportModule,
    // A school supplier signing up starts on the seasonal plan.
    SeasonalBillingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '8h',
        },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, PinLockoutService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
