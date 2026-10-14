import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { BuyerJwtStrategy } from './buyer-auth';
import { BuyerAuthService } from './buyer-auth.service';
import {
  BuyerAuthController,
  BuyerController,
  OnlineOrdersController,
  PublicShopsController,
  TumaCallbackController,
} from './online-orders.controller';
import { OnlineOrdersService } from './online-orders.service';
import { ShopCatalogService } from './shop-catalog.service';

@Module({
  imports: [
    PassportModule,
    InventoryModule,
    NotificationsModule,
    OnlineStoreModule,
    // A third independent JwtModule (after staff and platform admin) - its
    // own secret, so buyer tokens can't be confused with either. Long
    // expiry: shoppers expect to stay logged in on their phone.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('BUYER_JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('BUYER_JWT_EXPIRES_IN') ?? '30d' },
      }),
    }),
  ],
  controllers: [
    PublicShopsController,
    TumaCallbackController,
    BuyerAuthController,
    BuyerController,
    OnlineOrdersController,
  ],
  providers: [BuyerJwtStrategy, BuyerAuthService, OnlineOrdersService, ShopCatalogService, ObjectStorageService],
})
export class OnlineOrdersModule {}
