import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { TenderAdminService } from './tender-admin.service';
import { TenderAdvertsService } from './tender-adverts.service';
import {
  SchoolTenderBoardController,
  SchoolTenderPortalController,
  TenderBuyerAuthController,
  TenderBuyerController,
} from './tender-adverts.controller';
import { TenderBoardService } from './tender-board.service';
import { TenderBuyerJwtStrategy } from './tender-buyer-auth';
import { TenderBuyerAuthService } from './tender-buyer-auth.service';
import { TenderPortalBridgeService } from './tender-portal-bridge.service';

/**
 * Tender adverts: schools register, post what they want to buy, and every school-supplier business sees it (with an email alert).
 * School tokens share the buyer secret and are told apart by their scope claim (see tender-buyer-auth.ts).
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('BUYER_JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('SCHOOL_JWT_EXPIRES_IN') ?? '30d',
        },
      }),
    }),
  ],
  controllers: [
    TenderBuyerAuthController,
    TenderBuyerController,
    SchoolTenderBoardController,
    SchoolTenderPortalController,
  ],
  providers: [
    TenderBuyerAuthService,
    TenderAdvertsService,
    TenderBoardService,
    TenderAdminService,
    TenderPortalBridgeService,
    TenderBuyerJwtStrategy,
    ObjectStorageService,
  ],
  exports: [TenderAdminService],
})
export class TenderAdvertsModule {}
