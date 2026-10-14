import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NotificationsModule } from '../notifications/notifications.module';
import { RiderJwtStrategy } from './rider-auth';
import { RiderAuthService } from './rider-auth.service';
import { RiderAuthController, RiderController, ShopRidersController } from './riders.controller';
import { RidersService } from './riders.service';

@Module({
  imports: [
    PassportModule,
    NotificationsModule,
    // Rider tokens share the buyer secret and are told apart by their scope claim (see rider-auth.ts).
    // Long expiry, like shoppers: riders expect to stay signed in on their phone.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('BUYER_JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('RIDER_JWT_EXPIRES_IN') ?? '30d' },
      }),
    }),
  ],
  controllers: [RiderAuthController, RiderController, ShopRidersController],
  providers: [RiderJwtStrategy, RiderAuthService, RidersService],
  exports: [RidersService],
})
export class RidersModule {}
